import { ConsoleEmailAdapter } from './console-email.adapter';

describe('ConsoleEmailAdapter', () => {
  it('records sent messages for tests', async () => {
    const mail = new ConsoleEmailAdapter();
    await mail.send({
      to: 'a@example.com',
      subject: 'Hi',
      text: 'body',
    });
    expect(mail.sent).toHaveLength(1);
    expect(mail.lastTo('a@example.com')?.subject).toBe('Hi');
    mail.clear();
    expect(mail.sent).toHaveLength(0);
  });
});
