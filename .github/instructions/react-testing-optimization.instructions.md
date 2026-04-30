# React 17 Testing & Optimization Instructions

**Scope**: Testing, Performance, Error Handling | **Version**: 3.0 | **Tags**: `testing`, `msw`, `performance`, `error-handling`

**Related Files**: See [react-development.instructions.md](./react-development.instructions.md) for core patterns, [uiux.instructions.md](./uiux.instructions.md) for UI patterns

## Error Handling

### Error Boundary Pattern
```typescript
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorPage } from 'dh-component-library';
import { onErrorPopToast } from 'src/Hooks/query/helpers/onErrorPopToast';
import { t } from 'src/I18n';

// Wrap routes with ErrorBoundary
<ErrorBoundary FallbackComponent={ErrorPage}>
  <Routes>...</Routes>
</ErrorBoundary>

// API error handling pattern
const { data, isLoading } = useQuery(
  ['key', id, adAccountId],
  () => apiCall(),
  { onError: (err) => onErrorPopToast(err, t('errorMessageKey')) }
);

// Always use i18n keys for error messages, never hardcoded strings
```

## Suspense & Lazy Loading

```typescript
const ProductDetails = React.lazy(() => import('./ProductDetails'));

const App: React.FC = () => (
  <ErrorBoundary>
    <React.Suspense fallback={<div>Loading...</div>}>
      <ProductDetails productId="123" />
    </React.Suspense>
  </ErrorBoundary>
);
```

## Memoization & Optimization

```typescript
interface ProductListItemProps {
  product: Product;
  onSelect: (id: string) => void;
}

const ProductListItem = React.memo<ProductListItemProps>(({ product, onSelect }) => {
  const handleClick = React.useCallback(() => {
    onSelect(product.id);
  }, [product.id, onSelect]);

  const displayPrice = React.useMemo(() => {
    return `$${(product.price / 100).toFixed(2)}`;
  }, [product.price]);

  return (
    <div onClick={handleClick}>
      {product.name} - {displayPrice}
    </div>
  );
});

export default ProductListItem;
```

### When to Memoize

**Use `React.memo`**:
- Component renders often with same props
- Component is expensive to render
- Parent re-renders frequently

**Use `useMemo`**:
- Expensive calculations
- Creating objects/arrays passed as props
- Filtering/transforming large datasets

**Use `useCallback`**:
- Functions passed as props to memoized components
- Functions in dependency arrays
- Event handlers passed to child components

**DON'T memoize**:
- Cheap calculations
- Primitive values
- Components that always render with different props

## Testing (MSW + React Testing Library)

### Test Setup with MSW
```typescript
import { render, screen } from 'src/test/app-test-utils';
import { ComponentTestContainer } from 'src/test/app-test-utils';
import { server } from 'src/test/msw-api/server/test-server';
import { rest } from 'msw';
import { DATA_TEST_ID } from 'src/test/generic-ids';

describe('Component', () => {
  it('renders with context', () => {
    const mockActivation = { activationId: '123', name: 'Test' };
    
    render(
      <ComponentTestContainer state={{ activationMerged: mockActivation }}>
        <Component />
      </ComponentTestContainer>
    );
    
    expect(screen.getByTestId(DATA_TEST_ID.section.field)).toBeInTheDocument();
  });

  it('overrides MSW response', () => {
    server.use(
      rest.get('/api/booking-store/:id', (req, res, ctx) => 
        res(ctx.json({ data: 'override' }))
      )
    );
    
    render(<Component />);
    // Test with overridden response
  });
});

// Use app-test-utils for pre-configured providers
// MSW automatically mocked in setupTests.ts
```

### Testing Hooks
```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from 'react-query';

describe('useProduct', () => {
  it('fetches product data', async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    
    const { result } = renderHook(() => useProduct('123'), { wrapper });
    
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.product).toBeDefined();
    expect(result.current.error).toBeNull();
  });
});
```

### Testing User Interactions
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('ProductForm', () => {
  it('submits form with valid data', async () => {
    const mockSubmit = jest.fn();
    render(<ProductForm onSubmit={mockSubmit} />);
    
    // Type into inputs
    await userEvent.type(screen.getByLabelText(/name/i), 'Test Product');
    await userEvent.type(screen.getByLabelText(/price/i), '99.99');
    
    // Click submit
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    
    // Assert
    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        name: 'Test Product',
        price: 99.99,
      });
    });
  });
  
  it('shows validation errors', async () => {
    render(<ProductForm onSubmit={jest.fn()} />);
    
    // Submit without filling
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    
    // Assert errors shown
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });
});
```

### Testing Async Operations
```typescript
describe('ProductList', () => {
  it('shows loading state', () => {
    render(<ProductList />);
    expect(screen.getByTestId(DATA_TEST_ID.loadingSpinner)).toBeInTheDocument();
  });
  
  it('displays products after loading', async () => {
    render(<ProductList />);
    
    await waitFor(() => {
      expect(screen.queryByTestId(DATA_TEST_ID.loadingSpinner)).not.toBeInTheDocument();
    });
    
    expect(screen.getByText(/Product 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Product 2/i)).toBeInTheDocument();
  });
  
  it('shows error message on failure', async () => {
    server.use(
      rest.get('/api/products', (req, res, ctx) => 
        res(ctx.status(500), ctx.json({ error: 'Server error' }))
      )
    );
    
    render(<ProductList />);
    
    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
  });
});
```

## Performance Best Practices

### Code Splitting
```typescript
// Lazy load step components
const LazyStepComponent = lazy(() => import('./StepComponent'));

// Use in router
<Route 
  path="/step" 
  element={
    <Suspense fallback={<LoadingSpinner />}>
      <LazyStepComponent />
    </Suspense>
  } 
/>
```

### Bundle Optimization
```typescript
// ✅ Tree-shakeable imports
import { Button } from 'dh-component-library'; 
import { map, filter } from 'lodash';

// ❌ Avoid full imports
import * as DH from 'dh-component-library';
import _ from 'lodash';
```

### Virtualization for Long Lists
```typescript
import { FixedSizeList } from 'react-window';

const VirtualizedList: React.FC<{ items: Product[] }> = ({ items }) => (
  <FixedSizeList
    height={600}
    itemCount={items.length}
    itemSize={50}
    width="100%"
  >
    {({ index, style }) => (
      <div style={style}>{items[index].name}</div>
    )}
  </FixedSizeList>
);
```

### Debouncing & Throttling
```typescript
import { useMemo } from 'react';
import debounce from 'lodash/debounce';

const SearchInput: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const debouncedSearch = useMemo(
    () => debounce((value: string) => {
      // API call here
      console.log('Searching for:', value);
    }, 300),
    []
  );
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    debouncedSearch(e.target.value);
  };
  
  return <input value={searchTerm} onChange={handleChange} />;
};
```

## Common Performance Issues

### ❌ Creating Functions in Render
```typescript
// ❌ BAD: New function every render
<Button onClick={() => handleClick(id)} />

// ✅ GOOD: Memoized with useCallback
const handleButtonClick = useCallback(() => handleClick(id), [id]);
<Button onClick={handleButtonClick} />
```

### ❌ Creating Objects/Arrays in Render
```typescript
// ❌ BAD: New array every render
<Component items={products.filter(p => p.active)} />

// ✅ GOOD: Memoized with useMemo
const activeProducts = useMemo(() => products.filter(p => p.active), [products]);
<Component items={activeProducts} />
```

### ❌ Not Memoizing Expensive Calculations
```typescript
// ❌ BAD: Recalculates every render
const total = products.reduce((sum, p) => sum + p.price, 0);

// ✅ GOOD: Memoized
const total = useMemo(() => 
  products.reduce((sum, p) => sum + p.price, 0), 
  [products]
);
```

## Testing Checklist ✅

- All components have test coverage
- User interactions tested with userEvent
- Async operations tested with waitFor
- Error states tested
- Loading states tested
- MSW handlers for all API calls
- Test IDs used for querying elements
- No hardcoded waits (use waitFor)
- Tests isolated (no shared state)
- Cleanup after tests

## Performance Checklist ✅

- Lazy load route components
- Memoize expensive calculations
- Use React.memo for frequently re-rendering components
- useCallback for functions in dependency arrays
- Code splitting for large features
- Tree-shakeable imports
- Virtualization for long lists
- Debounce user input
- Optimize images (lazy loading, compression)

## Common Testing Mistakes ❌

- Using `getBy*` instead of `findBy*` for async elements
- Not waiting for async operations
- Testing implementation details instead of behavior
- Hardcoded waits (`setTimeout`)
- Not cleaning up after tests
- Missing act() warnings
- Not mocking external dependencies
- Snapshot tests for everything

## Resources

- [React Testing Library](https://testing-library.com/react)
- [MSW](https://mswjs.io/docs)
- [React Query Testing](https://react-query-v3.tanstack.com/guides/testing)
- [React Performance](https://reactjs.org/docs/optimizing-performance.html)
- [Web.dev React Performance](https://web.dev/react/)
