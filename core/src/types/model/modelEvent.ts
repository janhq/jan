/**
 * The `EventName` enumeration contains the names of all the available events in the Jan platform.
 */
export enum ModelEvent {
  /** The `OnModelStopped` event is emitted when a model stopped ok. */
  OnModelStopped = 'OnModelStopped',
  /** The `OnModelUpdate` event is emitted when the model list is updated. */
  OnModelsUpdate = 'OnModelsUpdate',
}
