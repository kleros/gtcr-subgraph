import { Address, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { NewItem } from '../../generated/templates/LightGeneralizedTCR/LightGeneralizedTCR';
import { newMockEvent } from 'matchstick-as';

export function createNewItemEvent(
  registry: string,
  itemID: string,
  data: string,
): NewItem {
  const mockEvent = newMockEvent();

  const newNewItemEvent = new NewItem(
    Address.fromString(registry),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt,
  );
  newNewItemEvent.parameters = [];

  const itemIDParam = new ethereum.EventParam(
    '_itemID',
    ethereum.Value.fromBytes(Bytes.fromHexString(itemID)),
  );
  const dataParam = new ethereum.EventParam(
    '_data',
    ethereum.Value.fromString(data),
  );
  const addedDirectlyParam = new ethereum.EventParam(
    '_addedDirectly',
    ethereum.Value.fromBoolean(false),
  );

  newNewItemEvent.parameters.push(itemIDParam);
  newNewItemEvent.parameters.push(dataParam);
  newNewItemEvent.parameters.push(addedDirectlyParam);

  return newNewItemEvent;
}
