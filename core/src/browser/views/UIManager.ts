// Define an enum for the component types
export enum UIComponent {
  RightPanelTabItem = 'right-panel-tab-item-component',
  InputChatBox = 'input-chat-box-component',
}

// Define object structures for each component type
interface TabItem {
  name: string
  value: string
  render?: any
}

interface InputChatBox {
  name: string
  icon: any
  render: any
  onClick: any
}

// Map each `UIComponent` to a corresponding object type
type TypeObjectMap = {
  [UIComponent.RightPanelTabItem]: TabItem
  [UIComponent.InputChatBox]: InputChatBox
}

// Utility type to extract the correct object type based on the `UIComponent`
type TypeObject<T extends UIComponent> = TypeObjectMap[T]

export class UIManager {
  // Change to store an array of objects for each component type
  public view = new Map<UIComponent, TypeObject<UIComponent>[]>()

  /**
   * Registers a UI by its type (defined in `UIComponent` enum).
   * @param type - The predefined type for the UI from the `UIComponent` enum.
   * @param view - The object to register, which depends on the type.
   */
  register<T extends UIComponent>(type: T, view: TypeObject<T>) {
    // Check if the type already has registered objects
    if (!this.view.has(type)) {
      this.view.set(type, []) // Initialize with an empty array if not present
    }
    // Push the new view object into the array for the given type
    this.view.get(type)?.push(view)
  }

  /**
   * Retrieves all registered UIs by type.
   * @param type - The type of the UI to retrieve.
   * @returns An array of UIs associated with the specified type, or an empty array if not found.
   */
  get<T extends UIComponent>(type: T): TypeObject<T>[] {
    return (this.view.get(type) as TypeObject<T>[]) || [] // Return an empty array if no entries are found
  }

  /**
   * Retrieves all registered UIs.
   * @returns An object containing all UIs with their registered component types as keys.
   */
  getAll(): Record<UIComponent, TypeObject<UIComponent>[]> {
    const ui: Record<UIComponent, TypeObject<UIComponent>[]> = {} as Record<
      UIComponent,
      TypeObject<UIComponent>[]
    >
    this.view.forEach((value, key) => {
      ui[key] = value // Map directly to the UI components array
    })
    return ui
  }

  /**
   * The instance of the UI manager.
   */
  static instance(): UIManager {
    return (window.core?.UIManager as UIManager) ?? new UIManager()
  }
}
