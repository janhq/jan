import { IStateTreeNode, SnapshotIn } from "mobx-state-tree"

/**
 * If you include this in your model in an action() block just under your props,
 * it'll allow you to set property values directly while retaining type safety
 * and also is executed in an action. This is useful because often you find yourself
 * making a lot of repetitive setter actions that only update one prop.
 *
 * E.g.:
 *
 *  const UserModel = types.model("User")
 *    .props({
 *      name: types.string,
 *      age: types.number
 *    })
 *    .actions(withSetPropAction)
 *
 *   const user = UserModel.create({ name: "Jamon", age: 40 })
 *
 *   user.setProp("name", "John") // no type error
 *   user.setProp("age", 30)      // no type error
 *   user.setProp("age", "30")    // type error -- must be number
 */
export const withSetPropAction = <T extends IStateTreeNode>(mstInstance: T) => ({
  // generic setter for all properties
  setProp<K extends keyof SnapshotIn<T>, V extends SnapshotIn<T>[K]>(field: K, newValue: V) {
    // @ts-ignore - for some reason TS complains about this, but it still works fine
    mstInstance[field] = newValue
  },
})
