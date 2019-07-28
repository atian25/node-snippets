'use strict';

const nock = require('nock');
const httpclient = require('urllib');
const assert = require('assert');

describe('test/mock-http.test.js', () => {

  afterEach(() => nock.cleanAll());

  it('should mock http', async () => {
    nock('http://some-url.com').get('/api').reply(200, 'hello');
    const { data } = await httpclient.request('http://some-url.com/api', { dataType: 'text' });
    assert(data === 'hello');
  });
});
