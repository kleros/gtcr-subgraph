import { Bytes, dataSource, json, log } from '@graphprotocol/graph-ts';
import { LRegistryMetadata } from '../../generated/schema';
import { JSONValueToBool, JSONValueToMaybeString } from '../utils';

export function handleLRegistryMetadata(content: Bytes): void {
  const ipfsHash = dataSource.stringParam();

  const parsedResult = json.try_fromBytes(content);

  const context = dataSource.context();
  const count = context.getBigInt('count');
  const address = context.getString('address');

  const id = `${ipfsHash}-${address}-${count.toString()}`;

  const metadata = new LRegistryMetadata(id);

  log.debug(`ipfs hash : {}, content : {}`, [ipfsHash, content.toString()]);

  if (!parsedResult.isOk || parsedResult.isError) {
    log.warning(`Error converting object for hash {}`, [ipfsHash]);
    metadata.save();
    return;
  }

  const value = parsedResult.value.toObject();

  const metadataValue = value.get('metadata');
  if (!metadataValue) {
    log.warning(`Error getting metadata values from ipfs hash {}`, [ipfsHash]);
    metadata.save();
    return;
  }

  const data = metadataValue.toObject();

  const title = data.get('tcrTitle');
  const description = data.get('tcrDescription');
  const itemName = data.get('itemName');
  const itemNamePlural = data.get('itemNamePlural');
  const isConnectedTCR = data.get('isConnectedTCR');
  const requireRemovalEvidence = data.get('requireRemovalEvidence');
  const isTCRofTcrs = data.get('isTCRofTcrs');
  const parentTCRAddress = data.get('parentTCRAddress');
  const relTcrDisabled = data.get('relTcrDisabled');

  metadata.title = JSONValueToMaybeString(title);
  metadata.description = JSONValueToMaybeString(description);
  metadata.itemName = JSONValueToMaybeString(itemName);
  metadata.parentTCRAddress = JSONValueToMaybeString(parentTCRAddress);
  metadata.itemNamePlural = JSONValueToMaybeString(itemNamePlural);
  metadata.isConnectedTCR = JSONValueToBool(isConnectedTCR);
  metadata.requireRemovalEvidence = JSONValueToBool(requireRemovalEvidence);
  metadata.isTCRofTcrs = JSONValueToBool(isTCRofTcrs);
  metadata.relTcrDisabled = JSONValueToBool(relTcrDisabled);

  metadata.save();
}
