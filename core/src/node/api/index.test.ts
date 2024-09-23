
import * as restfulV1 from './restful/v1';

it('should re-export from restful/v1', () => {
  const restfulV1Exports = require('./restful/v1');
  expect(restfulV1Exports).toBeDefined();
})
