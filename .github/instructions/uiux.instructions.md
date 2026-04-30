# UI/UX Design System Instructions (Store Media Client)

**Scope**: All design & component files | **Version**: 3.0 | **Tags**: `dh-component-library`, `emotion`, `accessibility`, `wcag`

## 🔴 MANDATORY: Use dh-component-library First
ALWAYS check dh-component-library and store-components before creating custom components:

**dh-component-library**: Button, Flex, Section, TextInput, DHIcon, ErrorPage, NotificationBanner, Spinner, LoaderOverlay, Toaster, ConfirmationDialog, ModalBox, GenericTable

**store-components**: PageCard, StoreDateRangePicker, TableDrawerTab, DataRow

Only create custom components when library components cannot meet requirements.

## Core Design Principles

### 1. Responsive Design
- **Mobile-First**: Design for 320px, then scale up
- **Breakpoints**: 320px (mobile) → 768px (tablet) → 1024px (desktop) → 1440px (wide) → 1920px (ultra-wide)
- **Fluid Typography**: Scale font sizes between breakpoints using `clamp()`
- **Flexible Layouts**: Grid/Flexbox with max-widths; avoid fixed widths

**CSS Example**:
```css
/* Font scaling */
h1 { font-size: clamp(24px, 5vw, 48px); }

/* Responsive spacing */
.container { 
  padding: clamp(16px, 5vw, 32px);
  max-width: 1200px;
  margin: 0 auto;
}

/* Grid layout */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: clamp(16px, 3vw, 32px);
}
```

### 2. Typography (dh-component-library Theme)
- **Use theme.typography**: h1, h2, h3, body1, body2, caption
- **Line Height**: Defined in theme (1.4-1.6 body, 1.2 headings)
- **Never hardcode**: Always use `theme.typography.*`

**Usage**:
```typescript
import styled from '@emotion/styled';
import { ThemeType } from 'src/types';

const Title = styled.h2<{ theme?: ThemeType }>(({ theme }) => ({
  ...theme?.typography.h2,
  color: theme?.palette?.greyscale?.[700],
  marginBottom: '16px',
}));
```

### 3. Color System (Theme Palette)
- **Greyscale**: theme.palette.greyscale[50-900] (50=lightest, 900=darkest)
- **Semantic**: primary, secondary, error, warning, success, info
- **Contrast**: WCAG AA minimum 4.5:1 (text), 3:1 (large text/UI)
- **Always use optional chaining**: `theme?.palette?.greyscale?.[200]`

**Pattern**:
```typescript
const FilterActions = styled(Flex)<{ theme?: ThemeType }>(({ theme }) => ({
  borderTop: `1px solid ${theme?.palette?.greyscale?.[200] || '#e5e7eb'}`,
  color: theme?.palette?.greyscale?.[700],
  // Provide fallback values for safety
}));
```

### 4. Spacing (Theme System)
- **Use theme.spacing()**: spacing(1)=8px, spacing(2)=16px, spacing(3)=24px
- **Direct values for gaps**: '16px', '24px' (common in project)
- **Consistent**: 4px, 8px, 12px, 16px, 24px, 32px, 48px

```typescript
const Container = styled.div<{ theme?: ThemeType }>(({ theme }) => ({
  padding: theme?.spacing?.(2) || '16px',
  gap: '24px',
  marginBottom: '16px',
}));
```

### 5. Accessibility (WCAG AA - Project Standards)

**Mandatory Checks**:
- ✅ Touch targets ≥ 44x44px (set in styled components)
- ✅ Color contrast ≥ 4.5:1 (verify with theme palette)
- ✅ data-testid on ALL interactive elements (hierarchical naming)
- ✅ Keyboard navigation: Tab order, focus indicators
- ✅ i18n: All text via `t('key')` from `src/I18n`
- ✅ Semantic HTML: Use dh-component-library components
- ✅ Skip links: Include on admin pages
- ✅ ARIA: aria-label, aria-describedby when needed

**Test ID Pattern**:
```typescript
import { DATA_TEST_ID } from 'src/test/generic-ids';

export const DATA_TEST_ID = {
  storeAvailability: {
    section: 'section-store-availability',
    field: {
      storeSearch: 'field-store-search',
    },
    button: {
      addStores: 'button-add-stores',
    },
  },
};

// Usage
<Button data-testid={DATA_TEST_ID.storeAvailability.button.addStores}>
  {t('addStores')}
</Button>
```
```

## Component Patterns (Project Standards)

### Form Components (Use dh-component-library)
```typescript
import { TextInput } from 'dh-component-library';
import { FormElementText } from 'src/Components/Forms/FormElements';
import { t } from 'src/I18n';

<FormElementText
  id="activation-name"
  label={t('activationName')}
  dataTestId={DATA_TEST_ID.generalInfo.field.name}
  isOptional={false}
  onChange={handleChange}
  onBlur={handleBlur}
  counterMaxLimit={255}
  unsafeNativeInputProps={{ placeholder: t('enterName') }}
/>
```

### Layout Structure
```tsx
import { PageCard } from 'store-components';
import { Section, Flex } from 'dh-component-library';

<Section gap="24">
  <PageCard 
    title={t('sectionTitle')} 
    titleDescription={t('sectionDescription')}
    divider
  >
    <Flex direction="column" gap="16px">
      {/* Content */}
    </Flex>
  </PageCard>
</Section>
```

### Styled Components Pattern
```typescript
import styled from '@emotion/styled';
import { Flex } from 'dh-component-library';
import { ThemeType } from 'src/types';

const FilterGrid = styled.div<{ theme?: ThemeType }>(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '24px',
  marginBottom: '24px',

  '& > *': {
    minHeight: '44px', // Accessibility: touch targets
  },

  '@media (max-width: 768px)': {
    gridTemplateColumns: '1fr',
    gap: '16px',
  },
}));

// Always include responsive breakpoints and accessibility standards
```

### Loading States
```typescript
import { LoadingSpinner } from 'src/Components/Layout/LoadingSpinner';
import { DATA_TEST_ID } from 'src/test/generic-ids';

// Overlay loading
<LoadingSpinner withBackdrop testId={DATA_TEST_ID.loadingSpinner} />

// Inline loading
<LoadingSpinner size={32} />
```

### Notifications
```typescript
import { NotificationBanner } from 'dh-component-library';
import { t } from 'src/I18n';

<NotificationBanner
  title={t('notificationTitle')}
  message={t('notificationMessage')}
  variant="warning" // 'success' | 'error' | 'info' | 'warning'
  dataTestId="notification-banner"
/>
```

## Common Mistakes ❌

- Creating custom components when dh-component-library has equivalent
- Hardcoding text instead of using `t('key')`
- Missing data-testid attributes
- Not using theme for colors/typography
- Touch targets < 44px
- Color contrast < 4.5:1
- Missing optional chaining: `theme?.palette?.greyscale?.[200]`
- Skipping responsive breakpoints

## Testing Checklist ✅

**Test IDs**:
- All interactive elements have hierarchical test IDs
- Pattern: `DATA_TEST_ID.section.subsection.element`
- Export from centralized file

**Keyboard Navigation**:
- Tab through all interactive elements
- Enter/Space activate buttons
- Escape closes modals

**Responsive** (Test at 320px, 768px, 1024px):
- Touch targets ≥ 44px
- Text readable at all breakpoints
- Grid layouts adapt correctly

**Contrast** (Use browser DevTools):
- Min 4.5:1 for text
- Min 3:1 for large text/UI

**i18n**:
- All text uses `t('key')`
- No hardcoded strings

## Tools

- **dh-component-library**: Primary component library
- **Emotion**: CSS-in-JS styling
- **MSW**: API mocking for tests
- **Cypress**: E2E testing
- **axe DevTools**: Accessibility audit
- **WebAIM**: Contrast checker

## Resources

- [dh-component-library Docs](https://dh-component-library-docs)
- [store-components API](https://store-components-docs)
- [Emotion Documentation](https://emotion.sh)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [WAI-ARIA Practices](https://www.w3.org/WAI/ARIA/apg/)
