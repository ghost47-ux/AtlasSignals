import { describe, expect, it } from 'vitest';
import { cleanReply, extractProseAction, hasActionIntent } from './chat';

describe('hasActionIntent', () => {
  it('detects action requests', () => {
    expect(hasActionIntent('take me to pricing')).toBe(true);
    expect(hasActionIntent('I want to upgrade')).toBe(true);
    expect(hasActionIntent('how do I link telegram?')).toBe(true);
    expect(hasActionIntent('open my dashboard')).toBe(true);
  });
  it('leaves plain questions alone', () => {
    expect(hasActionIntent('what is XAU/USD?')).toBe(false);
    expect(hasActionIntent('hello')).toBe(false);
  });
});

describe('extractProseAction', () => {
  it('extracts checkout for signed-in upgrade talk', () => {
    expect(extractProseAction('You can upgrade now. Opening the checkout.', true)).toEqual({
      type: 'start_checkout',
    });
  });
  it('routes telegram talk to the linking flow', () => {
    expect(extractProseAction('Go to settings and connect your Telegram.', true)).toEqual({
      type: 'link_telegram',
    });
  });
  it('maps route keywords', () => {
    expect(extractProseAction('See our pricing on the website.', false)).toEqual({
      type: 'navigate',
      to: '/#pricing',
    });
    expect(extractProseAction('Sign up for a free trial.', false)).toEqual({
      type: 'navigate',
      to: '/auth?mode=signup',
    });
    expect(extractProseAction('Open your dashboard.', true)).toEqual({
      type: 'navigate',
      to: '/dashboard',
    });
  });
  it('returns null for plain answers', () => {
    expect(extractProseAction('Signals are generated Monday to Friday.', false)).toBeNull();
  });
});

describe('cleanReply', () => {
  it('strips tool-call echoes', () => {
    expect(cleanReply('I\'m going to navigate_to("pricing") for you.')).toBe(
      "I'm going to for you.",
    );
    expect(cleanReply('Calling start_checkout() now.')).toBe('Calling now.');
  });
  it('collapses whitespace and trims', () => {
    expect(cleanReply('  a   b  \n\n\n  c ')).toBe('a b\n\nc');
  });
});
