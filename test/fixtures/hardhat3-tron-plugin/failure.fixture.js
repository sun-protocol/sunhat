import { it } from 'mocha';

it('preserves an intentional test failure during owned TRE cleanup', () => {
  throw new Error('EXPECTED_TRON_TEST_FAILURE');
});
