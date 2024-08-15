/**
 * The `EventName` enumeration contains the names of all the available events in the Jan platform.
 */
export enum ModelEvent {
  /** The `OnModelInit` event is emitted when a model inits. */
  OnModelInit = 'OnModelInit',
  /** The `OnModelReady` event is emitted when a model ready. */
  OnModelReady = 'OnModelReady',
  /** The `OnModelFail` event is emitted when a model fails loading. */
  OnModelFail = 'OnModelFail',
  /** The `OnModelStop` event is emitted when a model start to stop. */
  OnModelStop = 'OnModelStop',
  /** The `OnModelStopped` event is emitted when a model stopped ok. */
  OnModelStopped = 'OnModelStopped',
  /** The `OnModelUpdate` event is emitted when the model list is updated. */
  OnModelsUpdate = 'OnModelsUpdate',
}
