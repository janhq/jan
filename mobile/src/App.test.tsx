import { render } from '@testing-library/react';
import {expect} from 'vitest'
import App from './App';

test('renders without crashing', () => {
  const { baseElement } = render(<App />);
  expect(baseElement).toBeDefined();
});
