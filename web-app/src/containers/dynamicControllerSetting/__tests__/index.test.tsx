import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/containers/dynamicControllerSetting/InputControl', () => ({
  InputControl: (props: any) => <div data-testid="input-control" data-value={props.value} />,
}))
vi.mock('@/containers/dynamicControllerSetting/CheckboxControl', () => ({
  CheckboxControl: (props: any) => <div data-testid="checkbox-control" data-checked={props.checked} />,
}))
vi.mock('@/containers/dynamicControllerSetting/DropdownControl', () => ({
  DropdownControl: (props: any) => <div data-testid="dropdown-control" data-value={props.value} />,
}))
vi.mock('@/containers/dynamicControllerSetting/TextareaControl', () => ({
  TextareaControl: (props: any) => <div data-testid="textarea-control" data-value={props.value} />,
}))
vi.mock('@/containers/dynamicControllerSetting/SliderControl', () => ({
  SliderControl: (props: any) => <div data-testid="slider-control" />,
}))

import { DynamicControllerSetting } from '../index'

describe('DynamicControllerSetting', () => {
  it('renders InputControl for input type', () => {
    render(<DynamicControllerSetting controllerType="input" controllerProps={{ value: 'test' }} onChange={vi.fn()} />)
    expect(screen.getByTestId('input-control')).toBeInTheDocument()
  })

  it('renders CheckboxControl for checkbox type', () => {
    render(<DynamicControllerSetting controllerType="checkbox" controllerProps={{ value: true }} onChange={vi.fn()} />)
    expect(screen.getByTestId('checkbox-control')).toBeInTheDocument()
  })

  it('renders DropdownControl for dropdown type', () => {
    render(<DynamicControllerSetting controllerType="dropdown" controllerProps={{ value: 'a', options: [] }} onChange={vi.fn()} />)
    expect(screen.getByTestId('dropdown-control')).toBeInTheDocument()
  })

  it('renders TextareaControl for textarea type', () => {
    render(<DynamicControllerSetting controllerType="textarea" controllerProps={{ value: 'text' }} onChange={vi.fn()} />)
    expect(screen.getByTestId('textarea-control')).toBeInTheDocument()
  })

  it('renders SliderControl for slider type', () => {
    render(<DynamicControllerSetting controllerType="slider" controllerProps={{ value: 50, min: 0, max: 100 }} onChange={vi.fn()} />)
    expect(screen.getByTestId('slider-control')).toBeInTheDocument()
  })

  it('defaults to CheckboxControl for unknown type', () => {
    render(<DynamicControllerSetting controllerType="unknown" controllerProps={{ value: false }} onChange={vi.fn()} />)
    expect(screen.getByTestId('checkbox-control')).toBeInTheDocument()
  })
})
