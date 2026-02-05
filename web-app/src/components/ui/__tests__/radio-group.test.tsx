import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RadioGroup, RadioGroupItem } from '../radio-group'

describe('RadioGroup', () => {
  it('renders radio items correctly', () => {
    render(
      <RadioGroup defaultValue="http">
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="http" id="http" />
          <label htmlFor="http">HTTP</label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="sse" id="sse" />
          <label htmlFor="sse">SSE</label>
        </div>
      </RadioGroup>
    )

    expect(screen.getByLabelText('HTTP')).toBeInTheDocument()
    expect(screen.getByLabelText('SSE')).toBeInTheDocument()
  })

  it('allows selecting different options', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(
      <RadioGroup defaultValue="http" onValueChange={onValueChange}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="http" id="http" />
          <label htmlFor="http">HTTP</label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="sse" id="sse" />
          <label htmlFor="sse">SSE</label>
        </div>
      </RadioGroup>
    )

    await user.click(screen.getByLabelText('SSE'))
    expect(onValueChange).toHaveBeenCalledWith('sse')
  })

  it('has correct default selection', () => {
    render(
      <RadioGroup defaultValue="http">
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="http" id="http" />
          <label htmlFor="http">HTTP</label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="sse" id="sse" />
          <label htmlFor="sse">SSE</label>
        </div>
      </RadioGroup>
    )

    expect(screen.getByLabelText('HTTP')).toBeChecked()
    expect(screen.getByLabelText('SSE')).not.toBeChecked()
  })
})
