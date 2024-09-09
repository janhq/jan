
import { Stack } from './Stack';

it('should return elements in reverse order', () => {
  const stack = new Stack<number>();
  stack.push(1);
  stack.push(2);
  stack.push(3);
  const reversedOutput = stack.reverseOutput();
  expect(reversedOutput).toEqual([1, 2, 3]);
});


it('should pop an element from the stack', () => {
  const stack = new Stack<number>();
  stack.push(1);
  const poppedElement = stack.pop();
  expect(poppedElement).toBe(1);
  expect(stack.isEmpty()).toBe(true);
});


it('should push an element to the stack', () => {
  const stack = new Stack<number>();
  stack.push(1);
  expect(stack.isEmpty()).toBe(false);
  expect(stack.size()).toBe(1);
  expect(stack.peek()).toBe(1);
});


it('should initialize as empty', () => {
  const stack = new Stack<number>();
  expect(stack.isEmpty()).toBe(true);
});
