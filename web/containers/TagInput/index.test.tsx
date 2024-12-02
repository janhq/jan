import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import TagInput from './index' // Adjust the import path as necessary
import '@testing-library/jest-dom'

describe('TagInput Component', () => {
  let props: any

  beforeEach(() => {
    props = {
      title: 'Tags',
      name: 'tag-input',
      description: 'Add your tags',
      placeholder: 'Enter a tag',
      value: ['tag1', 'tag2'],
      onValueChanged: jest.fn(),
    }
  })

  it('renders correctly', () => {
    const { getByText, getByPlaceholderText } = render(<TagInput {...props} />)
    expect(getByText('Tags')).toBeInTheDocument()
    expect(getByText('tag1')).toBeInTheDocument()
    expect(getByText('tag2')).toBeInTheDocument()
    expect(getByPlaceholderText('Enter a tag')).toBeInTheDocument()
  })

  it('calls onValueChanged when a new tag is added', () => {
    const { getByPlaceholderText } = render(<TagInput {...props} />)
    const input = getByPlaceholderText('Enter a tag')

    fireEvent.change(input, { target: { value: 'tag3' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(props.onValueChanged).toHaveBeenCalledWith(
      expect.arrayContaining(['tag1', 'tag2', 'tag3'])
    )
  })

  it('calls onValueChanged when a tag is removed', () => {
    const { getAllByRole } = render(<TagInput {...props} />)
    const removeButton = getAllByRole('button')[0] // Click on the first remove button

    fireEvent.click(removeButton)

    expect(props.onValueChanged).toHaveBeenCalledWith(
      expect.arrayContaining(['tag2'])
    )
  })
})
