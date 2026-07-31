import {
  classifyError,
  dlqTopic,
  HandlerError,
  parseTopicLadder,
  RETRY_TIERS,
  retryTopic,
} from './retry';

describe('retry ladder helpers', () => {
  it('builds retry and dlq topic names', () => {
    expect(retryTopic('social.post.v1', 0)).toBe('social.post.v1.retry.5s');
    expect(retryTopic('social.post.v1', 1)).toBe('social.post.v1.retry.1m');
    expect(retryTopic('social.post.v1', 2)).toBe('social.post.v1.retry.10m');
    expect(dlqTopic('social.post.v1')).toBe('social.post.v1.dlq');
  });

  it('parses ladder topics', () => {
    expect(parseTopicLadder('social.post.v1')).toEqual({
      baseTopic: 'social.post.v1',
      tierIndex: -1,
      isDlq: false,
    });
    expect(parseTopicLadder('social.post.v1.retry.5s')).toEqual({
      baseTopic: 'social.post.v1',
      tierIndex: 0,
      isDlq: false,
    });
    expect(parseTopicLadder('social.post.v1.retry.10m')).toEqual({
      baseTopic: 'social.post.v1',
      tierIndex: 2,
      isDlq: false,
    });
    expect(parseTopicLadder('social.post.v1.dlq')).toEqual({
      baseTopic: 'social.post.v1',
      tierIndex: RETRY_TIERS.length,
      isDlq: true,
    });
  });

  it('classifies errors', () => {
    expect(classifyError(new HandlerError('x', 'poison'))).toBe('poison');
    expect(classifyError(new HandlerError('x', 'semantic'))).toBe('semantic');
    expect(classifyError(new SyntaxError('bad json'))).toBe('poison');
    expect(classifyError(new Error('connection timeout'))).toBe('transient');
    expect(classifyError(new Error('parent not found'))).toBe('semantic');
  });
});
