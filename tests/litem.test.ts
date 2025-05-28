import {
  Address,
  Bytes,
  DataSourceContext,
  ethereum,
} from '@graphprotocol/graph-ts';
import {
  afterAll,
  assert,
  beforeAll,
  clearStore,
  createMockedFunction,
  dataSourceMock,
  describe,
  readFile,
  test,
} from 'matchstick-as/assembly/index';
import { ZERO } from '../src/utils';
import { createNewItemEvent } from './utils/litem-utils';
import { handleNewGTCR } from '../src/LightGTCRFactoryMapping';
import { handleNewItem } from '../src/LightGeneralizedTCRMapping';
import { handleLItemMetadata } from '../src/fileHandlers/LItemMetadataHandler';
import {
  GRAPH_ITEM_ID,
  IPFS_HASH,
  ITEM_DATA,
  ITEM_ID,
  REGISTRY_ADDRESS,
} from './utils/mockValues';
import { createNewGTCREvent } from './utils/lregistry-utils';

// mock getItemInfo function, called inside handleNewItem
createMockedFunction(
  Address.fromString(REGISTRY_ADDRESS),
  'getItemInfo',
  'getItemInfo(bytes32):(uint8,uint256,uint256)',
)
  .withArgs([ethereum.Value.fromFixedBytes(Bytes.fromHexString(ITEM_ID))])
  .returns([
    ethereum.Value.fromI32(0),
    ethereum.Value.fromUnsignedBigInt(ZERO),
    ethereum.Value.fromUnsignedBigInt(ZERO),
  ]);

describe('Testing LItem creation', () => {
  beforeAll(() => {
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

  test('Should create LItem entity', () => {
    const newItemEvent = createNewItemEvent(
      REGISTRY_ADDRESS,
      ITEM_ID,
      ITEM_DATA,
    );

    handleNewItem(newItemEvent);

    assert.fieldEquals('LItem', GRAPH_ITEM_ID, 'id', GRAPH_ITEM_ID);
  });

  test('Should create LItemMetadata datasource', () => {
    // previous test should have created this datasource
    assert.dataSourceExists('LItemMetadata', IPFS_HASH);

    const context = new DataSourceContext();
    context.setString('graphItemID', GRAPH_ITEM_ID);
    context.setString('address', REGISTRY_ADDRESS);
    dataSourceMock.setReturnValues(IPFS_HASH, 'arbitrum-one', context);

    const content = readFile('tests/ipfs/item.json');

    handleLItemMetadata(content);

    const metadataEntityId = `${IPFS_HASH}-${GRAPH_ITEM_ID}`;

    assert.fieldEquals(
      'LItemMetadata',
      metadataEntityId,
      'id',
      metadataEntityId,
    );
    dataSourceMock.resetValues();
  });

  afterAll(() => {
    clearStore();
  });
});
