# .NET Core 8 API & Integration Instructions

**Scope**: DI, Controllers, Auth, Validation | **Version**: 2.0 | **Tags**: `api`, `authentication`, `dependency-injection`

**Related Files**: See [dotnet-development.instructions.md](./dotnet-development.instructions.md) for core patterns, [dotnet-testing.instructions.md](./dotnet-testing.instructions.md) for testing

## Dependency Injection & Configuration

### DI Registration in Startup.ConfigureServices
Register services with appropriate lifetimes: **Transient** (new instance each time), **Scoped** (per request), **Singleton** (application lifetime).

```csharp
public class Startup {
    public void ConfigureServices(IServiceCollection services) {
        // Configuration & Options Pattern
        services.AddOptions().Configure<Settings>(options => Configuration.Bind(options));
        
        // DbContext (scoped per request)
        services.AddDbContext<StoreMediaDbContext>();
        services.AddServiceBundle(Configuration);

        // Repositories & Unit of Work (scoped)
        services.AddScoped<IMediaElementRepository, MediaElementRepository>();
        services.AddScoped<IUnitOfWork, UnitOfWork>();

        // Query Handlers & Commands (scoped)
        services.AddScoped<GetPresetElementsHandler>();
        
        // Mappers (scoped or transient)
        services.AddScoped<ProductMapper>();

        // Services (scoped per business logic)
        services.AddScoped<IProductService, ProductService>();

        // HTTP & Middleware
        services.AddHttpContextAccessor();
        services.AddMemoryCache();
        services.AddMediatR(typeof(Program));

        // Controllers with JSON options
        services.AddControllers()
            .AddJsonOptions(opts => {
                opts.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
                opts.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
            });
    }
}
```

### Settings Class & IOptions Pattern
```csharp
// Configuration/Settings.cs
public class Settings {
    public DatabaseSettings Database { get; set; }
    public PubSubSettings PubSub { get; set; }
    public string BaseUri { get; set; }
}

// In appsettings.json
{
  "Settings": {
    "Database": { "ConnectionString": "..." },
    "BaseUri": "https://api.example.com"
  }
}

// Usage in Service
public class ProductService {
    private readonly Settings _settings;
    
    public ProductService(IOptions<Settings> options) {
        _settings = options.Value;
    }
}
```

## Validation

### FluentValidation Pattern
```csharp
public class CreateProductCommandValidator : AbstractValidator<CreateProductCommand> {
    private readonly StoreMediaDbContext _dbContext;

    public CreateProductCommandValidator(StoreMediaDbContext dbContext) {
        _dbContext = dbContext;

        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Name is required")
            .MaximumLength(255).WithMessage("Name must not exceed 255 characters");

        RuleFor(x => x.Price)
            .GreaterThan(0).WithMessage("Price must be greater than zero");

        // Async rule: check database uniqueness
        RuleFor(x => x.Name)
            .MustAsync(async (name, ct) => {
                var exists = await _dbContext.Products.AnyAsync(p => p.Name == name, ct);
                return !exists;
            })
            .WithMessage("Product name already exists");
    }
}

// Register in DI
services.AddScoped<IValidator<CreateProductCommand>, CreateProductCommandValidator>();
```

## API Controllers

### Controller Pattern with MediatR
```csharp
[ApiController]
[Route("v2/products")]
public class ProductController : ControllerBase {
    private readonly IMediator _mediator;

    public ProductController(IMediator mediator) {
        _mediator = mediator;
    }

    /// <summary>
    /// Creates a new product.
    /// </summary>
    [HttpPost]
    [ScopedPermissions(Permissions.ProductAdmin)]
    [ProducesResponseType(typeof(ProductDto), 201)]
    [ProducesResponseType(typeof(ProblemDetails), 400)]
    public async Task<IActionResult> CreateProductAsync([FromBody] CreateProductCommand command) {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        
        var result = await _mediator.Send(command, HttpContext.RequestAborted);
        return CreatedAtAction(nameof(GetProductAsync), new { id = result.Id }, result);
    }

    /// <summary>
    /// Gets a product by ID.
    /// </summary>
    [HttpGet("{id}")]
    [ScopedPermissions(Permissions.ProductView)]
    [ProducesResponseType(typeof(ProductDto), 200)]
    [ProducesResponseType(typeof(ProblemDetails), 404)]
    public async Task<ActionResult<ProductDto>> GetProductAsync(string id) {
        var query = new GetProductQuery { Id = id };
        return Ok(await _mediator.Send(query, HttpContext.RequestAborted));
    }
}
```

### Global Error Handling (ProblemDetails)
```csharp
// Startup.ConfigureServices
services.AddProblemDetails(options => {
    options.IncludeExceptionDetails = (_, _) => _environment.IsDevelopment();
    options.Map<NotFoundException>(e => new ProblemDetails {
        Title = "Resource Not Found",
        Status = StatusCodes.Status404NotFound,
        Detail = e.Message
    });
    options.Map<ValidationException>(e => new ProblemDetails {
        Title = "Validation Error",
        Status = StatusCodes.Status400BadRequest,
        Detail = string.Join("; ", e.Errors.Select(x => x.ErrorMessage))
    });
});

// Startup.Configure
app.UseProblemDetails();
```

## Logging & Error Handling

### Structured Logging with Serilog
```csharp
// Program.cs
public static IWebHostBuilder CreateHostBuilder(string[] args) {
    return new WebHostBuilder()
        .UseSerilog((context, loggerConfig) => {
            loggerConfig
                .MinimumLevel.Information()
                .WriteTo.Console()
                .Enrich.FromLogContext()
                .Enrich.WithProperty("ApplicationName", "StoreMediaApi");
        });
}

// Usage in Handlers
public class CreateProductCommandHandler : IRequestHandler<CreateProductCommand, ProductDto> {
    private readonly ILogger<CreateProductCommandHandler> _logger;

    public async Task<ProductDto> Handle(CreateProductCommand request, CancellationToken ct) {
        _logger.LogInformation("Creating product: {ProductName}", request.Name);
        
        try {
            var product = Product.Create(request.Name, request.Price, request.RetailerId);
            await _unitOfWork.Products.AddAsync(product, ct);
            await _unitOfWork.SaveChangesAsync(ct);
            
            _logger.LogInformation("Product created: {ProductId}", product.Id);
            return _mapper.MapToDto(product);
        } catch (Exception ex) {
            _logger.LogError(ex, "Error creating product: {ErrorMessage}", ex.Message);
            throw;
        }
    }
}
```

### Custom Error Codes for Monitoring
```csharp
public static class ErrorCodes {
    public const string OutboxUpdateFailure = "SMA-OutboxUpdateFailure";
    public const string ServiceCallFailure = "SMA-ServiceToServiceCallFailure";
    public const string ValidationFailure = "SMA-ValidationFailure";
}

// Usage
_logger.LogError("Failed: {ErrorCode} for {Entity}", ErrorCodes.OutboxUpdateFailure, "Activation");
```

## Authorization & Authentication

### JWT & Permissions via ServiceBundle
```csharp
// Startup.ConfigureServices
services.AddServiceBundle(Configuration); // Includes auth middleware
services.AddScoped<IPermissionsManagerV4Client, PermissionsManagerV4Client>();

// Controller: Use [ScopedPermissions] attribute
[HttpPost]
[ScopedPermissions(Permissions.StoreMediaAdmin)]
public async Task<IActionResult> CreateAsync([FromBody] CreateCommand cmd) {
    return await _mediator.Send(cmd);
}

// Extract JWT from HttpContext
public static class HttpContextExtensions {
    public static string ExtractJwt(this IHttpContextAccessor accessor) {
        var authHeader = accessor.HttpContext?.Request.Headers["Authorization"].FirstOrDefault();
        return authHeader?.Replace("Bearer ", "") ?? string.Empty;
    }
}

// Custom Authorization Filter
[ExcludeFromCodeCoverage]
public class HangfireAuthorizationFilter : IDashboardAuthorizationFilter {
    private readonly IPermissionsManagerV4Client _permissionsManager;

    public HangfireAuthorizationFilter(IPermissionsManagerV4Client permissionsManager) {
        _permissionsManager = permissionsManager;
    }

    public bool Authorize(DashboardContext context) {
        var httpContext = context.GetHttpContext();
        var jwt = httpContext.Request.Headers["Authorization"].FirstOrDefault()?.Replace("Bearer ", "");
        
        if (string.IsNullOrEmpty(jwt)) return false;

        var permissions = _permissionsManager.GetPermissions(jwt).Result;
        return permissions.Contains(Permissions.HangfireDashboard);
    }
}
```

## Security Best Practices

### Input Validation & SQL Injection Prevention
```csharp
// ✅ GOOD: Input validation via FluentValidation
public class CreateProductCommandValidator : AbstractValidator<CreateProductCommand> {
    public CreateProductCommandValidator() {
        RuleFor(x => x.Name)
            .NotEmpty()
            .MaximumLength(255)
            .Matches(@"^[a-zA-Z0-9\s\-_]+$").WithMessage("Invalid characters");

        RuleFor(x => x.Price)
            .GreaterThan(0)
            .LessThan(1000000);
            
        RuleFor(x => x.Email)
            .EmailAddress().When(x => !string.IsNullOrEmpty(x.Email));
    }
}

// ✅ GOOD: Parameterized queries (EF Core default)
var products = await _dbContext.Products
    .Where(p => p.RetailerId == retailerId)
    .ToListAsync();

// ❌ BAD: Raw SQL with string interpolation (SQL injection risk)
var products = await _dbContext.Products
    .FromSqlRaw($"SELECT * FROM products WHERE retailer_id = '{retailerId}'")
    .ToListAsync();
```

### Secrets Management
```csharp
// ✅ GOOD: Secrets via configuration, never hardcoded
public class Startup {
    public void ConfigureServices(IServiceCollection services) {
        var connectionString = Configuration.GetConnectionString("DefaultConnection");
        services.AddDbContext<AppDbContext>(options => 
            options.UseNpgsql(connectionString));
    }
}

// ✅ GOOD: Azure Key Vault integration
public class Program {
    public static IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args)
            .ConfigureAppConfiguration((context, config) => {
                if (context.HostingEnvironment.IsProduction()) {
                    var builtConfig = config.Build();
                    config.AddAzureKeyVault(builtConfig["KeyVaultUrl"]);
                }
            });
}
```

### HTTPS & CORS
```csharp
// ✅ GOOD: HTTPS & CORS restrictions
public class Startup {
    public void ConfigureServices(IServiceCollection services) {
        services.AddCors(options => {
            options.AddPolicy("AllowedOrigins", builder => {
                builder.WithOrigins("https://trusted-domain.com")
                    .AllowAnyMethod()
                    .AllowAnyHeader()
                    .AllowCredentials();
            });
        });

        services.AddHttpsRedirection(options => {
            options.HttpsPort = 443;
        });
    }

    public void Configure(IApplicationBuilder app) {
        app.UseHttpsRedirection();
        app.UseCors("AllowedOrigins");
    }
}
```

### Audit Logging
```csharp
// ✅ GOOD: Audit logging for sensitive operations
_logger.LogInformation(
    "Product created by user {UserId}: {ProductId}, Name: {ProductName}",
    userId, 
    product.Id, 
    product.Name);
```

## XML Documentation & Swagger

### XML Comments for API Documentation
```csharp
/// <summary>
/// Creates a new product in the system.
/// </summary>
/// <param name="command">The product creation command with required fields.</param>
/// <returns>The created product with generated ID.</returns>
/// <response code="201">Product created successfully.</response>
/// <response code="400">Invalid input data.</response>
/// <response code="404">Related entity not found.</response>
[HttpPost]
[ProducesResponseType(typeof(ProductDto), 201)]
[ProducesResponseType(typeof(ProblemDetails), 400)]
public async Task<IActionResult> CreateProductAsync([FromBody] CreateProductCommand command) {
    // Implementation
}

// Startup: Enable Swagger XML documentation
services.AddSwaggerGen(options => {
    var xmlFile = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    options.IncludeXmlComments(xmlPath);
});
```

## Quick Checklist ✅

- DI registrations use correct lifetime (Transient/Scoped/Singleton)
- IOptions<T> pattern for configuration
- FluentValidation for all commands/queries
- MediatR for CQRS handlers
- [ScopedPermissions] on all endpoints
- Structured logging with Serilog
- ProblemDetails for error responses
- XML documentation on public APIs
- Secrets via configuration/Key Vault
- HTTPS enforced in production
- CORS restricted to trusted origins
- Audit logging for sensitive operations

## Common Mistakes ❌

- Hardcoding secrets/connection strings
- Missing input validation
- Not using parameterized queries
- Business logic in controllers
- No authorization checks
- Missing structured logging
- Raw exceptions exposed to clients
- CORS allowing all origins
- No audit trail for sensitive operations

## Resources

- [Microsoft ASP.NET Core Docs](https://docs.microsoft.com/aspnet/core/)
- [FluentValidation](https://fluentvalidation.net/)
- [MediatR](https://github.com/jbogard/MediatR)
- [Serilog](https://serilog.net/)
- [RFC 7807 Problem Details](https://tools.ietf.org/html/rfc7807)
