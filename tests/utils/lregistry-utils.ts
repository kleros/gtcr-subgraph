import { Address, ethereum } from '@graphprotocol/graph-ts';
import { newMockEvent } from 'matchstick-as';
import { NewGTCR } from '../../generated/LightGTCRFactory/LightGTCRFactory';

export function createNewGTCREvent(address: string): NewGTCR {
  const mockEvent = newMockEvent();

  const newGTCREvent = new NewGTCR(
    mockEvent.address,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt,
  );
  newGTCREvent.parameters = [];

  const addressParam = new ethereum.EventParam(
    '_address',
    ethereum.Value.fromAddress(Address.fromString(address)),
  );

  newGTCREvent.parameters.push(addressParam);

  return newGTCREvent;
}
