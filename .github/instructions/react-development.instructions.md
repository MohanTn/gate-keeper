# React 17 Development Instructions

**Scope**: All `.tsx`/`.ts` files | **Version**: 3.0 | **Tags**: `react`, `typescript`, `hooks`, `emotion`, `react-query`

**Related Files**: See [react-testing-optimization.instructions.md](./react-testing-optimization.instructions.md) for testing & optimization

## 🔴 MANDATORY: Import Organization
Group: **React** → **Third-party** → **dh-component-library/store-components** → **Local Components** → **Hooks** → **Utils/API** → **Types**

```typescript
import { useState, useCallback } from 'react';
import { useQuery } from 'react-query';
import styled from '@emotion/styled';
import { Button, Flex } from 'dh-component-library';
import { PageCard } from 'store-components';
import { FormElementText } from 'src/Components/Forms/FormElements';
import { useGetActivationPrice } from 'src/Hooks/query/pricingData';
import { activationPrice } from 'src/api';
import { t } from 'src/I18n';
import { Activation, ThemeType } from 'src/types';
```

## Core Patterns

| Pattern | Usage |
|---------|-------|
| **Functional Components** | `export function Component({ prop }: Props)` OR `const Component: React.FC<Props>` |
| **Emotion Styling** | `styled(Component)<Props>(({ theme }) => ({ ... }))` with ThemeType |
| **React Query v3** | `useQuery(['key', id, adAccountId], fn, { onError: onErrorPopToast })` |
| **Context Providers** | Cascade: Theme → User → Configuration → PostHog → Domain contexts |
| **Custom Hooks** | Prefix `use*`, return object: `{ data, isLoading, error }` |
| **Test IDs** | Hierarchical: `DATA_TEST_ID.section.field.name` |
| **i18n** | All text: `t('translationKey')` from `src/I18n` |

## Functional Components

```typescript
interface ProductProps {
  productId: string;
  onSelect?: (id: string) => void;
}

const Product: React.FC<ProductProps> = ({ productId, onSelect }) => {
  const [isLoading, setIsLoading] = React.useState(false);
  
  const handleClick = React.useCallback(() => {
    setIsLoading(true);
    onSelect?.(productId);
  }, [productId, onSelect]);

  return (
    <div onClick={handleClick} className={isLoading ? 'loading' : ''}>
      {productId}
    </div>
  );
};

export default Product;
```

## Custom Hooks

```typescript
interface UseProductReturn {
  product: Product | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export const useProduct = (productId: string): UseProductReturn => {
  const [product, setProduct] = React.useState<Product | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  const fetchProduct = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/products/${productId}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setProduct(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  React.useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  return { product, loading, error, refetch: fetchProduct };
};
```

## Context API

```typescript
interface ProductContextType {
  selectedProduct: Product | null;
  selectProduct: (product: Product) => void;
}

const ProductContext = React.createContext<ProductContextType | undefined>(undefined);

export const ProductProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedProduct, setSelectedProduct] = React.useState<Product | null>(null);

  const value: ProductContextType = {
    selectedProduct,
    selectProduct: (product) => setSelectedProduct(product),
  };

  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
};

export const useProductContext = () => {
  const context = React.useContext(ProductContext);
  if (!context) throw new Error('useProductContext must be used within ProductProvider');
  return context;
};
```

## React Query v3 (Project Standard)

```typescript
import { useQuery, UseQueryOptions } from 'react-query';
import { AxiosError } from 'axios';
import { onErrorPopToast } from './helpers/onErrorPopToast';
import { t } from 'src/I18n';

// Query hook pattern
export function useGetActivationPrice(options?: UseQueryOptions<Pricing, AxiosError>) {
  const { activationMerged } = useStoreMediaContext();
  const { adAccountId } = useUserContext();

  const { data, isLoading, error, isError } = useQuery<Pricing, AxiosError>(
    ['activationPrice', activationMerged.activationId, adAccountId],
    () => activationPrice(activationMerged.activationId),
    {
      onError: (err) => onErrorPopToast(err, t('getPricingError')),
      enabled: !!activationMerged.activationId,
      ...options,
    }
  );

  return { dataActivationPrice: data, isLoadingActivationPrice: isLoading, isErrorActivationPrice: isError };
}

// CRITICAL: Always include adAccountId in query keys for multi-tenancy
// Use descriptive return names: data{EntityName}, isLoading{EntityName}
```

## Emotion Styling (Project Standard)

```typescript
import styled from '@emotion/styled';
import { Flex } from 'dh-component-library';
import { ThemeType } from 'src/types';

// Styled component with theme
const FilterActions = styled(Flex)<{ theme?: ThemeType }>(({ theme }) => ({
  gap: '16px',
  justifyContent: 'flex-end',
  marginTop: '24px',
  paddingTop: '16px',
  borderTop: `1px solid ${theme?.palette?.greyscale?.[200] || '#e5e7eb'}`,

  '& button': {
    minWidth: '44px',
    minHeight: '44px',
  },

  '@media (max-width: 768px)': {
    flexDirection: 'column',
    gap: '12px',
  },
}));

// Always use optional chaining for theme properties
// Include responsive breakpoints: 768px (tablet), 1024px (desktop)
// Ensure touch targets ≥ 44px for accessibility
```

## Type Safety

```typescript
// ✅ Good: Proper typing with interfaces and generics
interface Product {
  id: string;
  name: string;
  price: number;
  retailerId: string;
}

interface UseAsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

const useAsync = <T,>(fn: () => Promise<T>): UseAsyncState<T> => {
  // implementation
  return { data: null, loading: false, error: null };
};

// ❌ Bad: No typing, unclear props/returns
const useAsync = (fn) => {
  return { data: null, loading: false, error: null };
};
```

## Project Dependencies

```bash
# Core (React 17 - DO NOT upgrade to 18)
yarn add react@^17.0.2 react-dom@^17.0.2

# State & Data Fetching
yarn add react-query@^3.39.3 axios@^1.12.0

# Styling
yarn add @emotion/react @emotion/styled
yarn add dh-component-library@5.37.47 store-components@^0.0.47

# Routing (Dual setup required for portal integration)
yarn add react-router-dom@5.1.2
yarn add react-router-dom6@npm:react-router-dom@^6.2.1

# Testing
yarn add -D @testing-library/react @testing-library/user-event
yarn add -D msw@^1.1.0 cypress dh-cypress-support

# Utilities
yarn add lodash ramda react-toastify file-saver react-error-boundary
```

## Project-Specific Patterns

### Context Cascading Order
```typescript
App → ThemeProvider → UserContext → ConfigurationProvider → PostHogProvider
  → StoreMediaProvider → RegionsEstatesProvider → SelectedStoresProvider
```

### Multi-Step Navigation
```typescript
// Each step: { title, route, component, provider, isValid?, subSteps? }
const step = {
  title: t('stepTitle'),
  route: 'step-route',
  component: StepComponent,
  provider: StepProvider,
};
```

### API Call Pattern
```typescript
import { apiCall } from 'src/api/utils';

export const getActivation = (id: string): Promise<Activation> =>
  apiCall({ url: `/api/booking-store/${id}`, method: 'GET' });
```

### Test ID Convention
```typescript
export const DATA_TEST_ID = {
  stepName: {
    section: 'section-step-name',
    field: { fieldName: 'field-name' },
    button: { submit: 'step-submit-button' },
  },
};
```

## Quick Checklist ✅

- Imports: React → Third-party → Components → Hooks/Utils → Types
- Props typed with interfaces
- Components are `React.FC<Props>`
- All handlers wrapped in `useCallback`
- `useEffect` dependencies correct
- Custom hooks follow naming: `use*`
- State lifted appropriately or use Context
- React Query for server state
- Forms use validation
- Error boundary wraps app/sections
- Memoization with `React.memo()`, `useMemo()`, `useCallback()`
- No `any` types
- No side effects in render

## Common Mistakes ❌

- Import order not organized
- Missing TypeScript types
- useCallback missing dependencies
- useEffect infinite loops (missing/wrong dependencies)
- Mixing server & client state management
- Inline object/array in props (creates new refs each render)
- Props mutation directly
- useEffect with async directly (use wrapper function)
- Missing error boundary
- Not memoizing expensive computations
- Rendering without keys in lists
- `console.log()` left in production code

## Resources

- [React Query v3](https://react-query-v3.tanstack.com)
- [Emotion](https://emotion.sh)
- [dh-component-library](https://dh-component-library-docs)
- [TypeScript React](https://react-typescript-cheatsheet.netlify.app/)
