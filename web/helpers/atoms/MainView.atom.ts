import { atom } from 'jotai'
import { setActiveConvoIdAtom } from './Conversation.atom'
import { systemBarVisibilityAtom } from './SystemBar.atom'

export enum MainViewState {
  Welcome,
  CreateBot,
  ExploreModel,
  MyModel,
  ResourceMonitor,
  Setting,
  Conversation,

  /**
   * When user wants to create new conversation but haven't selected a model yet.
   */
  ConversationEmptyModel,

  BotInfo,
  RemoteServer
}

/**
 * Stores the current main view state. Default is Welcome.
 */
const currentMainViewStateAtom = atom<MainViewState>(MainViewState.Welcome)

/**
 * Getter for current main view state.
 */
export const getMainViewStateAtom = atom((get) => get(currentMainViewStateAtom))

/**
 * Setter for current main view state.
 */
export const setMainViewStateAtom = atom(
  null,
  (get, set, state: MainViewState) => {
    // return if the state is already set
    if (get(getMainViewStateAtom) === state) return

    if (state !== MainViewState.Conversation) {
      // clear active conversation id if main view state is not Conversation
      set(setActiveConvoIdAtom, undefined)
    }

    const showSystemBar =
      state !== MainViewState.Conversation &&
      state !== MainViewState.ConversationEmptyModel

    // show system bar if state is not Conversation nor ConversationEmptyModel
    set(systemBarVisibilityAtom, showSystemBar)

    set(currentMainViewStateAtom, state)
  }
)
