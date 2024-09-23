// GenerateResponse.test.tsx
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import GenerateResponse from './GenerateResponse';

jest.useFakeTimers();

describe('GenerateResponse Component', () => {
  it('renders initially with 1% loader width', () => {
    render(<GenerateResponse />);
    const loader = screen.getByTestId('response-loader');
    expect(loader).toHaveStyle('width: 24%');
  });

  it('updates loader width over time', () => {
    render(<GenerateResponse />);
    const loader = screen.getByTestId('response-loader');

    // Advance timers to simulate time passing
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(loader).not.toHaveStyle('width: 1%');
    expect(parseFloat(loader.style.width)).toBeGreaterThan(1);
  });

  it('pauses at specific percentages', () => {
    render(<GenerateResponse />);
    const loader = screen.getByTestId('response-loader');

    // Advance to 24%
    act(() => {
      for (let i = 0; i < 24; i++) {
        jest.advanceTimersByTime(50);
      }
    });

    expect(loader).toHaveStyle('width: 50%');

    // Advance past the pause
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(loader).toHaveStyle('width: 78%');
  });

  it('stops at 85%', () => {
    render(<GenerateResponse />);
    const loader = screen.getByTestId('response-loader');

    // Advance to 50%
    act(() => {
      for (let i = 0; i < 85; i++) {
        jest.advanceTimersByTime(50);
      }
    });

    expect(loader).toHaveStyle('width: 50%');

    // Check if it stays at 78%
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(loader).toHaveStyle('width: 78%');
  });

  it('displays the correct text', () => {
    render(<GenerateResponse />);
    expect(screen.getByText('Generating response...')).toBeInTheDocument();
  });
});
