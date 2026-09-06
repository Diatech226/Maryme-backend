import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('does not enforce password length during login', async () => {
    const dto = Object.assign(new LoginDto(), { email: 'user@example.com', password: 'x' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('still validates email and password types', async () => {
    const dto = Object.assign(new LoginDto(), { email: 'invalid', password: 42 });
    const properties = (await validate(dto)).map(({ property }) => property);
    expect(properties).toEqual(expect.arrayContaining(['email', 'password']));
  });
});
