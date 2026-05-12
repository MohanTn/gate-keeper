import { fixText } from './fix-text';
import { Fix } from '../types';

describe('fixText', () => {
  it('returns undefined for undefined input', () => {
    expect(fixText(undefined)).toBeUndefined();
  });

  it('returns the string as-is when fix is a string', () => {
    expect(fixText('Use unknown instead of any')).toBe('Use unknown instead of any');
  });

  it('returns description when fix is an object', () => {
    const fix: Fix = {
      description: 'Replace with logger.debug',
      replacement: 'logger.debug',
      confidence: 'deterministic',
    };
    expect(fixText(fix)).toBe('Replace with logger.debug');
  });

  it('treats null as no fix', () => {
    expect(fixText(null as unknown as undefined)).toBeUndefined();
  });
});
