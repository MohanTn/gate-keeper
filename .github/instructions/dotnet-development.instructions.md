# .NET Core 8 Development Instructions

**Scope**: All `.cs` files | **Version**: 2.0 | **Tags**: `csharp`, `.net`, `dotnet-core-8`, `cqrs`, `clean-architecture`

**Related Files**: See [dotnet-api-integration.instructions.md](./dotnet-api-integration.instructions.md) for DI/API patterns, [dotnet-testing.instructions.md](./dotnet-testing.instructions.md) for testing

## 🔴 MANDATORY: Using Statements Organization
Group at top: **System** → **Third-party** (Microsoft, AutoMapper) → **Application** (RetailApp.*). Never fully-qualify.

```csharp
using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using AutoMapper;
using RetailApp.Application.Products.Services;

namespace RetailApp.Presentation.Controllers;
```

## Architecture Patterns

| Pattern | Rules |
|---------|-------|
| **CQRS** | Commands (write) → `ICommand<TResult>` handlers; Queries (read) separate |
| **Clean Architecture** | Core → Application → Infrastructure → Presentation |
| **Single Class Per File** | One public type per file |
| **Repository Pattern** | Generic `IRepository<T>` + `IUnitOfWork` |
| **Service Layer** | Business logic, validation, DI via constructor |
| **Async/Await** | All I/O async; support CancellationToken |

## Database Conventions

- **C# Properties**: PascalCase (ProductName, RetailerId)
- **Database**: snake_case (product_name, retailer_id)
- **Foreign Keys**: {EntityName}_id (retailer_id, product_id)
- **Indexes**: idx_table_column (idx_products_retailer_id)
- **Audit Fields**: CreatedAt, UpdatedAt, CreatedBy, UpdatedBy

## Core Code Patterns

### BaseEntity
```csharp
public abstract class BaseEntity {
    public Guid Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public string? CreatedBy { get; set; }
    public string? UpdatedBy { get; set; }
}
```

### Command Handler (CQRS)
```csharp
public class CreateProductCommandHandler : ICommandHandler<CreateProductCommand, ProductDto> {
    private readonly IUnitOfWork _unitOfWork;
    private readonly ProductMapper _mapper;
    private readonly ILogger<CreateProductCommandHandler> _logger;

    public async Task<ProductDto> HandleAsync(CreateProductCommand command, CancellationToken ct) {
        var product = _mapper.MapToEntity(command);
        await _unitOfWork.Products.AddAsync(product, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return _mapper.MapToDto(product);
    }
}
```

### Query Handler (CQRS)
```csharp
public class GetProductQueryHandler : IQueryHandler<GetProductQuery, ProductDto> {
    private readonly IRepository<Product> _repository;
    private readonly ProductMapper _mapper;

    public async Task<ProductDto> HandleAsync(GetProductQuery query, CancellationToken ct) {
        var product = await _repository.GetByIdAsync(query.ProductId, ct);
        if (product == null) throw new NotFoundException("Product not found");
        return _mapper.MapToDto(product);
    }
}
```

### Service Layer
```csharp
public class ProductService : IProductService {
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<ProductService> _logger;

    public async Task<ProductDto> CreateProductAsync(CreateProductCommand cmd, CancellationToken ct) {
        var product = Product.Create(cmd.Name, cmd.Price, cmd.RetailerId);
        await _unitOfWork.Products.AddAsync(product, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return new ProductDto { Id = product.Id, Name = product.Name };
    }
}
```

### Entity
```csharp
public class Product : BaseEntity {
    public string Name { get; set; } = string.Empty;
    public decimal Price { get; set; }
    public int StockQuantity { get; set; }
    public string RetailerId { get; set; } = string.Empty;

    public static Product Create(string name, decimal price, string retailerId) {
        if (price < 0) throw new ArgumentOutOfRangeException(nameof(price));
        return new Product { Id = Guid.NewGuid(), Name = name, Price = price, RetailerId = retailerId };
    }
}
```

### Entity Configuration (Fluent API)
```csharp
public class ProductConfiguration : IEntityTypeConfiguration<Product> {
    public void Configure(EntityTypeBuilder<Product> builder) {
        builder.ToTable("products");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Name).HasMaxLength(255).IsRequired();
        builder.Property(p => p.Price).HasPrecision(10, 2);
        builder.HasIndex(p => p.RetailerId).HasDatabaseName("idx_products_retailer_id");
    }
}
```

### Repository Pattern
```csharp
public interface IRepository<T> where T : BaseEntity {
    Task<T?> GetByIdAsync(Guid id, CancellationToken ct);
    Task<IEnumerable<T>> ListAsync(CancellationToken ct);
    Task AddAsync(T entity, CancellationToken ct);
    void Update(T entity);
    void Delete(T entity);
}

public class Repository<T> : IRepository<T> where T : BaseEntity {
    protected readonly DbContext _dbContext;
    
    public async Task<T?> GetByIdAsync(Guid id, CancellationToken ct) => 
        await _dbContext.Set<T>().FirstOrDefaultAsync(x => x.Id == id, ct);
    public async Task<IEnumerable<T>> ListAsync(CancellationToken ct) => 
        await _dbContext.Set<T>().ToListAsync(ct);
    public async Task AddAsync(T entity, CancellationToken ct) { 
        await _dbContext.Set<T>().AddAsync(entity, ct); 
    }
    public void Update(T entity) => _dbContext.Set<T>().Update(entity);
    public void Delete(T entity) => _dbContext.Set<T>().Remove(entity);
}
```

### Unit of Work Pattern
```csharp
public interface IUnitOfWork : IAsyncDisposable {
    IRepository<Product> Products { get; }
    IRepository<Order> Orders { get; }
    Task<int> SaveChangesAsync(CancellationToken ct = default);
    Task BeginTransactionAsync(CancellationToken ct = default);
    Task CommitTransactionAsync(CancellationToken ct = default);
    Task RollbackTransactionAsync(CancellationToken ct = default);
}
```

### Multi-Table Transactions
```csharp
await _unitOfWork.BeginTransactionAsync(ct);
try {
    await _unitOfWork.Products.AddAsync(product, ct);
    await _unitOfWork.Orders.AddAsync(order, ct);
    await _unitOfWork.SaveChangesAsync(ct);
    await _unitOfWork.CommitTransactionAsync(ct);
} catch {
    await _unitOfWork.RollbackTransactionAsync(ct);
    throw;
}
```

### Mapperly Configuration
```bash
dotnet add package Mapperly
```

```csharp
[Mapper]
public partial class ProductMapper {
    public partial ProductDto MapToDto(Product product);
    public partial Product MapToEntity(CreateProductCommand command);
}

// Advanced: Collections & nested objects
[Mapper]
public partial class OrderMapper {
    public partial OrderDto MapToDto(Order order);
    
    [MapProperty(nameof(Order.Items), nameof(OrderDto.LineItems))]
    public partial OrderDto CustomMapping(Order order);
    
    private string MapStatus(OrderStatus status) => status.ToString();
}
```

## Async Best Practices

### Async/Await Patterns
```csharp
// ✅ GOOD: Async method returns Task
public async Task<ProductDto> GetProductAsync(string id, CancellationToken ct) {
    return await _repository.GetByIdAsync(id, ct);
}

// ❌ BAD: Async void - cannot be awaited, hides exceptions
public async void ProcessProductAsync(string id) { }

// ✅ GOOD: Properly wait in background jobs
[DisableConcurrentExecution(10, "Background-Job")]
public class BackgroundPublishJobHandler {
    public async Task ExecuteAsync(CancellationToken ct) {
        await ProcessBatchAsync(ct);
    }
}
```

## Code Style & Formatting

### Naming Conventions
```csharp
// Naming conventions
public class ProductService { // PascalCase for class names
    private readonly ILogger _logger; // camelCase with underscore for private fields
    public string ProductName { get; set; } // PascalCase for properties
    
    public async Task<Product> GetProductAsync(string id) { // Async suffix
        var product = await _repository.GetAsync(id); // camelCase for local variables
        return product;
    }
}

// Interface naming
public interface IProductRepository { }  // I prefix
public interface IProductService { }    // I prefix
```

### Run formatting
```bash
dotnet format  # Auto-fix style issues
dotnet format --verify-no-changes  # Check only
```

## Performance Best Practices

### Query Optimization
```csharp
// ✅ GOOD: Async streaming for large datasets
public async IAsyncEnumerable<ProductDto> GetProductsStreamAsync(CancellationToken ct) {
    await foreach (var product in _dbContext.Products.AsAsyncEnumerable().WithCancellation(ct)) {
        yield return _mapper.MapToDto(product);
    }
}

// ✅ GOOD: Pagination
public async Task<PagedResult<ProductDto>> GetProductsPaginatedAsync(
    int pageNumber, int pageSize, CancellationToken ct) {
    var total = await _dbContext.Products.CountAsync(ct);
    var items = await _dbContext.Products
        .Skip((pageNumber - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync(ct);
    return new PagedResult<ProductDto> { 
        Items = items.Select(_mapper.MapToDto), 
        Total = total 
    };
}

// ✅ GOOD: Explicit includes, no lazy loading
public async Task<Product> GetProductWithDetailsAsync(string id, CancellationToken ct) {
    return await _dbContext.Products
        .Include(p => p.Category)
        .Include(p => p.Supplier)
        .FirstOrDefaultAsync(p => p.Id == id, ct);
}

// ✅ GOOD: Memory caching with TTL
public async Task<ProductDto> GetProductCachedAsync(string id, CancellationToken ct) {
    return await _cache.GetOrCreateAsync($"product:{id}", async entry => {
        entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
        return await GetProductAsync(id, ct);
    });
}
```

## Essential CLI Commands

```bash
# Package Management
dotnet add package PackageName
dotnet restore
dotnet list package --outdated

# Build & Run
dotnet build
dotnet build --configuration Release
dotnet run
dotnet watch run
dotnet clean

# EF Migrations
dotnet ef migrations add InitialCreate --project Infrastructure
dotnet ef migrations list
dotnet ef database update
dotnet ef database drop --force
dotnet ef migrations script > migration.sql

# Publishing
dotnet publish --configuration Release --output ./publish
dotnet publish --self-contained -r linux-x64

# Code Quality
dotnet format
dotnet build --verbosity diagnostic
```

## Quick Checklist ✅

- Using statements: System → Third-party → Application
- One public type per file
- CQRS: Commands & Queries in separate handlers
- Repository + Unit of Work for data access
- Service layer for business logic
- Mapperly for DTO mapping
- Entity properties: PascalCase; DB columns: snake_case
- Audit fields in BaseEntity
- Foreign keys follow {EntityName}_id pattern
- All async methods support CancellationToken
- Transactions for multi-table operations
- No fully-qualified namespace references

## Common Mistakes ❌

- Using fully-qualified names instead of `using` statements
- Multiple public types in one file
- Missing CancellationToken in async methods
- Business logic in controllers/endpoints
- Missing audit field updates
- Skipped transaction handling for multi-table ops
- No logging of important operations
- Missing error handling
- Ignoring test failures

## Resources

- [Microsoft .NET Docs](https://docs.microsoft.com/dotnet/)
- [Entity Framework Core](https://docs.microsoft.com/ef/core/)
- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html)
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Mapperly](https://mapperly.riok.app/)
