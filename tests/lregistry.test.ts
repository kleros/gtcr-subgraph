import {
  afterAll,
  assert,
  clearStore,
  describe,
  test,
} from 'matchstick-as/assembly/index';
import { handleNewGTCR } from '../src/LightGTCRFactoryMapping';
import { REGISTRY_ADDRESS } from './utils/mockValues';
import { createNewGTCREvent } from './utils/lregistry-utils';

describe('Testing LRegistry creation', () => {
  test('Should create LRegistry entity', () => {
    const newGTCREvent = createNewGTCREvent(REGISTRY_ADDRESS);

    handleNewGTCR(newGTCREvent);

    assert.fieldEquals(
      'LRegistry',
      REGISTRY_ADDRESS,
      'id',
      REGISTRY_ADDRESS,
      'LRegistry not created',
    );
  });

  test('Should create datasource', () => {
    const newGTCREvent = createNewGTCREvent(REGISTRY_ADDRESS);

    handleNewGTCR(newGTCREvent);

    assert.dataSourceCount('LightGeneralizedTCR', 1);
  });

  afterAll(() => {
    clearStore();
  });
});
