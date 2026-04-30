# .NET Core 8 Testing Instructions

**Scope**: Unit, Integration, Test Patterns | **Version**: 2.0 | **Tags**: `testing`, `xunit`, `moq`, `integration-tests`

**Related Files**: See [dotnet-development.instructions.md](./dotnet-development.instructions.md) for core patterns, [dotnet-api-integration.instructions.md](./dotnet-api-integration.instructions.md) for API patterns

## Unit Testing

### InMemory DbContext Factory
```csharp
public static class InMemoryDbContextFactory {
    public static RetailAppDbContext CreateDbContext() {
        var options = new DbContextOptionsBuilder<RetailAppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        
        var retailer = new Mock<ICurrentRetailer>();
        retailer.Setup(x => x.RetailerId).Returns("test");
        
        var user = new Mock<ICurrentUser>();
        user.Setup(x => x.UserId).Returns("test-user");
        
        return new RetailAppDbContext(options, retailer.Object, user.Object);
    }
}
```

### Unit Test Pattern
```csharp
[Fact]
public async Task CreateProductAsync_WithValidInput_ReturnsProductDto() {
    // Arrange
    var dbContext = InMemoryDbContextFactory.CreateDbContext();
    var unitOfWork = new UnitOfWork(dbContext);
    var mapper = new ProductMapper();
    var service = new ProductService(unitOfWork, mapper);
    
    var cmd = new CreateProductCommand { 
        Name = "Test Product", 
        Price = 99.99m, 
        RetailerId = "r1" 
    };
    
    // Act
    var result = await service.CreateProductAsync(cmd, CancellationToken.None);
    
    // Assert
    Assert.NotNull(result);
    Assert.Equal("Test Product", result.Name);
    Assert.Equal(99.99m, result.Price);
}

[Fact]
public async Task CreateProductAsync_WithNegativePrice_ThrowsException() {
    // Arrange
    var service = new ProductService(new Mock<IUnitOfWork>().Object, new Mock<ProductMapper>().Object);
    var cmd = new CreateProductCommand { Name = "Test", Price = -10, RetailerId = "r1" };
    
    // Act & Assert
    await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => 
        service.CreateProductAsync(cmd, CancellationToken.None));
}

[Theory]
[InlineData("", 99.99, "r1")] // Empty name
[InlineData("Product", 0, "r1")] // Zero price
[InlineData("Product", 99.99, "")] // Empty retailer
public async Task CreateProductAsync_WithInvalidInput_ThrowsValidationException(
    string name, decimal price, string retailerId) {
    // Arrange
    var service = new ProductService(new Mock<IUnitOfWork>().Object, new Mock<ProductMapper>().Object);
    var cmd = new CreateProductCommand { Name = name, Price = price, RetailerId = retailerId };
    
    // Act & Assert
    await Assert.ThrowsAsync<ValidationException>(() => 
        service.CreateProductAsync(cmd, CancellationToken.None));
}
```

### Mocking with Moq
```csharp
[Fact]
public async Task GetProductAsync_WhenProductExists_ReturnsProduct() {
    // Arrange
    var mockRepo = new Mock<IRepository<Product>>();
    var expectedProduct = new Product { Id = Guid.NewGuid(), Name = "Test" };
    
    mockRepo.Setup(r => r.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
        .ReturnsAsync(expectedProduct);
    
    var service = new ProductService(mockRepo.Object, new Mock<ProductMapper>().Object);
    
    // Act
    var result = await service.GetProductAsync(expectedProduct.Id, CancellationToken.None);
    
    // Assert
    Assert.NotNull(result);
    Assert.Equal("Test", result.Name);
    mockRepo.Verify(r => r.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Once);
}

[Fact]
public async Task GetProductAsync_WhenProductNotFound_ThrowsNotFoundException() {
    // Arrange
    var mockRepo = new Mock<IRepository<Product>>();
    mockRepo.Setup(r => r.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
        .ReturnsAsync((Product?)null);
    
    var service = new ProductService(mockRepo.Object, new Mock<ProductMapper>().Object);
    
    // Act & Assert
    await Assert.ThrowsAsync<NotFoundException>(() => 
        service.GetProductAsync(Guid.NewGuid(), CancellationToken.None));
}
```

### Testing FluentValidation
```csharp
[Fact]
public async Task Validator_WithValidCommand_PassesValidation() {
    // Arrange
    var dbContext = InMemoryDbContextFactory.CreateDbContext();
    var validator = new CreateProductCommandValidator(dbContext);
    var command = new CreateProductCommand { 
        Name = "Valid Product", 
        Price = 99.99m, 
        RetailerId = "r1" 
    };
    
    // Act
    var result = await validator.ValidateAsync(command);
    
    // Assert
    Assert.True(result.IsValid);
    Assert.Empty(result.Errors);
}

[Fact]
public async Task Validator_WithEmptyName_FailsValidation() {
    // Arrange
    var dbContext = InMemoryDbContextFactory.CreateDbContext();
    var validator = new CreateProductCommandValidator(dbContext);
    var command = new CreateProductCommand { Name = "", Price = 99.99m, RetailerId = "r1" };
    
    // Act
    var result = await validator.ValidateAsync(command);
    
    // Assert
    Assert.False(result.IsValid);
    Assert.Contains(result.Errors, e => e.PropertyName == nameof(CreateProductCommand.Name));
}

[Fact]
public async Task Validator_WithDuplicateName_FailsValidation() {
    // Arrange
    var dbContext = InMemoryDbContextFactory.CreateDbContext();
    await dbContext.Products.AddAsync(new Product { Name = "Duplicate", Price = 50, RetailerId = "r1" });
    await dbContext.SaveChangesAsync();
    
    var validator = new CreateProductCommandValidator(dbContext);
    var command = new CreateProductCommand { Name = "Duplicate", Price = 99.99m, RetailerId = "r1" };
    
    // Act
    var result = await validator.ValidateAsync(command);
    
    // Assert
    Assert.False(result.IsValid);
    Assert.Contains(result.Errors, e => e.ErrorMessage.Contains("already exists"));
}
```

## Integration Testing

### WebApplicationFactory Setup
```csharp
public class StoreMediaApiWebApplicationFactory : WebApplicationFactory<Startup> {
    protected override void ConfigureWebHost(IWebHostBuilder builder) {
        builder.ConfigureTestServices(services => {
            // Replace real DB with in-memory or test DB
            services.RemoveAll(typeof(DbContextOptions<StoreMediaDbContext>));
            services.AddDbContext<StoreMediaDbContext>(options =>
                options.UseInMemoryDatabase("test-db-" + Guid.NewGuid()));
            
            // Override external dependencies
            var mockCostingApi = new Mock<ICostingApi>();
            services.AddScoped(_ => mockCostingApi.Object);
        });
    }
    
    public void WithStoreMediaDbContext(Action<StoreMediaDbContext> action) {
        using var scope = Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<StoreMediaDbContext>();
        action(dbContext);
    }
}
```

### Integration Test Pattern
```csharp
public class ProductIntegrationTests : IClassFixture<StoreMediaApiWebApplicationFactory> {
    private readonly WebApplicationFactory<Startup> _factory;
    
    public ProductIntegrationTests(StoreMediaApiWebApplicationFactory factory) {
        _factory = factory;
    }
    
    [Fact]
    public async Task CreateProduct_WithValidRequest_Returns201Created() {
        // Arrange
        var client = _factory.CreateClient();
        var command = new CreateProductCommand { 
            Name = "Integration Test Product", 
            Price = 99.99m, 
            RetailerId = "r1" 
        };
        
        // Act
        var response = await client.PostAsJsonAsync("/api/v2/products", command);
        
        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var result = JsonConvert.DeserializeObject<ProductDto>(
            await response.Content.ReadAsStringAsync());
        result?.Name.Should().Be("Integration Test Product");
    }
    
    [Fact]
    public async Task GetProduct_WhenExists_Returns200Ok() {
        // Arrange
        var productId = Guid.NewGuid().ToString();
        _factory.WithStoreMediaDbContext(ctx => {
            ctx.Products.Add(new Product { 
                Id = productId, 
                Name = "Test Product", 
                Price = 50 
            });
            ctx.SaveChanges();
        });
        
        var client = _factory.CreateClient();
        
        // Act
        var response = await client.GetAsync($"/api/v2/products/{productId}");
        
        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = JsonConvert.DeserializeObject<ProductDto>(
            await response.Content.ReadAsStringAsync());
        result?.Name.Should().Be("Test Product");
    }
    
    [Fact]
    public async Task GetProduct_WhenNotFound_Returns404NotFound() {
        // Arrange
        var client = _factory.CreateClient();
        
        // Act
        var response = await client.GetAsync($"/api/v2/products/{Guid.NewGuid()}");
        
        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
```

### Configuration Testing
```csharp
[Fact]
public void PricingConfiguration_IsSeededAndRetrievable() {
    _factory.WithStoreMediaDbContext(ctx => {
        // Arrange & Act
        var ofdConfig = ConfigurationEntity.GetCfgValue(
            ctx, 
            ConfigurationKeys.OfdPricingConfiguration);
        
        // Assert
        ofdConfig.Should().NotBeNullOrEmpty();
        var pricingConfig = JsonConvert.DeserializeObject<PricingConfiguration>(ofdConfig!);
        pricingConfig?.PricingApiStrategy.Should().Be("StoreMediaApi.Pricing.OfdPricing");
    });
}
```

## Test Coverage

### Coverage Goals
- **Unit Tests**: ≥ 80% coverage for services & handlers
- **Integration Tests**: Critical business flows (activation publishing, pricing, validation)
- **Exclude from coverage**: Migrations, Controllers (thin layer), Seed Data, Configuration classes

### Run Coverage
```bash
# Run tests with coverage
dotnet test /p:CollectCoverage=true

# Generate coverage report
dotnet test /p:CollectCoverage=true /p:CoverageReportFormat=opencover

# View coverage in console
dotnet test /p:CollectCoverage=true /p:CoverageReportFormat=console
```

### Coverage Exclusions (.csproj)
```xml
<PropertyGroup>
  <ExcludeByAttribute>ExcludeFromCodeCoverage;Obsolete;GeneratedCode</ExcludeByAttribute>
  <ExcludeByFile>**/Migrations/*.cs;**/Program.cs;**/Startup.cs</ExcludeByFile>
</PropertyGroup>
```

## Essential CLI Commands

```bash
# Testing
dotnet test
dotnet test --filter "ClassName~ProductTests"
dotnet test /p:CollectCoverage=true
dotnet test --logger "console;verbosity=detailed"
dotnet test --no-build --verbosity normal

# Watch mode for TDD
dotnet watch test

# Run specific test project
dotnet test ./Tests/UnitTests/UnitTests.csproj

# Parallel execution (faster)
dotnet test --parallel

# List all tests
dotnet test --list-tests
```

## Test Organization

### Project Structure
```
Solution/
├── src/
│   ├── Core/
│   ├── Application/
│   ├── Infrastructure/
│   └── Presentation/
└── tests/
    ├── UnitTests/
    │   ├── Services/
    │   ├── Handlers/
    │   └── Validators/
    ├── IntegrationTests/
    │   ├── Api/
    │   ├── Database/
    │   └── Factories/
    └── TestHelpers/
        ├── Builders/
        ├── Fakes/
        └── Factories/
```

### Naming Conventions
```csharp
// Test class naming: [ClassUnderTest]Tests
public class ProductServiceTests { }

// Test method naming: [Method]_[Scenario]_[Expected]
[Fact]
public void CreateProduct_WithNegativePrice_ThrowsException() { }

[Fact]
public void GetProduct_WhenProductExists_ReturnsProduct() { }

[Fact]
public void DeleteProduct_WhenProductNotFound_ThrowsNotFoundException() { }
```

## Quick Checklist ✅

- Unit tests use InMemoryDatabase or mocks
- Integration tests use WebApplicationFactory
- Test methods follow naming convention: Method_Scenario_Expected
- All assertions use FluentAssertions or xUnit asserts
- Mocks verified with Times.Once/Times.Never
- Test coverage ≥ 80% for business logic
- Integration tests cover critical flows
- No real database/external APIs in tests
- Test isolation (each test independent)
- Cleanup after tests (dispose DbContext)

## Common Mistakes ❌

- Using real database in unit tests
- Not disposing DbContext in tests
- Tests with external dependencies (APIs, DB)
- Missing test isolation (shared state between tests)
- No assertions (test passes but validates nothing)
- Hardcoded values instead of test data builders
- Not testing edge cases and error paths
- Ignoring test failures
- No integration tests for critical flows

## Resources

- [xUnit Documentation](https://xunit.net/)
- [Moq Documentation](https://github.com/moq/moq4)
- [FluentAssertions](https://fluentassertions.com/)
- [WebApplicationFactory Testing](https://docs.microsoft.com/aspnet/core/test/integration-tests)
- [EF Core Testing](https://docs.microsoft.com/ef/core/testing/)
