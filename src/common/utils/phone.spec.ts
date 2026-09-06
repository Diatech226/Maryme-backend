import { normalizePhoneNumber } from './phone';

describe('normalizePhoneNumber', () => {
  it.each([
    ['+226 70-00-00-00', '+22670000000'],
    ['00226 (70) 00 00 00', '+22670000000'],
  ])('normalizes %s', (input, expected) => expect(normalizePhoneNumber(input)).toBe(expected));

  it.each(['70 00 00 00', '+012345678', '+226abc'])('rejects non-E.164 input %s', (input) => {
    expect(() => normalizePhoneNumber(input)).toThrow('E.164');
  });
});
