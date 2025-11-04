import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Capabilities from '../Capabilities'

// Mock Tooltip components
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock Tabler icons
vi.mock('@tabler/icons-react', () => ({
  IconEye: () => <div data-testid="icon-eye">Eye Icon</div>,
  IconTool: () => <div data-testid="icon-tool">Tool Icon</div>,
  IconSparkles: () => <div data-testid="icon-sparkles">Sparkles Icon</div>,
  IconAtom: () => <div data-testid="icon-atom">Atom Icon</div>,
  IconWorld: () => <div data-testid="icon-world">World Icon</div>,
  IconCodeCircle2: () => <div data-testid="icon-code">Code Icon</div>,
}))

describe('Capabilities', () => {
  it('should render vision capability with eye icon', () => {
    render(<Capabilities capabilities={['vision']} />)

    const eyeIcon = screen.getByTestId('icon-eye')
    expect(eyeIcon).toBeInTheDocument()
  })

  it('should render tools capability with tool icon', () => {
    render(<Capabilities capabilities={['tools']} />)

    const toolIcon = screen.getByTestId('icon-tool')
    expect(toolIcon).toBeInTheDocument()
  })

  it('should NOT render proactive icon without tools and vision', () => {
    render(<Capabilities capabilities={['proactive']} />)

    const sparklesIcon = screen.queryByTestId('icon-sparkles')
    expect(sparklesIcon).not.toBeInTheDocument()
  })

  it('should render proactive capability with sparkles icon when tools and vision are present', () => {
    render(<Capabilities capabilities={['tools', 'vision', 'proactive']} />)

    const sparklesIcon = screen.getByTestId('icon-sparkles')
    expect(sparklesIcon).toBeInTheDocument()
  })

  it('should render reasoning capability with atom icon', () => {
    render(<Capabilities capabilities={['reasoning']} />)

    const atomIcon = screen.getByTestId('icon-atom')
    expect(atomIcon).toBeInTheDocument()
  })

  it('should render web_search capability with world icon', () => {
    render(<Capabilities capabilities={['web_search']} />)

    const worldIcon = screen.getByTestId('icon-world')
    expect(worldIcon).toBeInTheDocument()
  })

  it('should render embeddings capability with code icon', () => {
    render(<Capabilities capabilities={['embeddings']} />)

    const codeIcon = screen.getByTestId('icon-code')
    expect(codeIcon).toBeInTheDocument()
  })

  it('should render multiple capabilities', () => {
    render(<Capabilities capabilities={['tools', 'vision', 'proactive']} />)

    expect(screen.getByTestId('icon-tool')).toBeInTheDocument()
    expect(screen.getByTestId('icon-eye')).toBeInTheDocument()
    expect(screen.getByTestId('icon-sparkles')).toBeInTheDocument()
  })

  it('should render all capabilities in correct order', () => {
    render(<Capabilities capabilities={['tools', 'vision', 'proactive', 'reasoning', 'web_search', 'embeddings']} />)

    expect(screen.getByTestId('icon-tool')).toBeInTheDocument()
    expect(screen.getByTestId('icon-eye')).toBeInTheDocument()
    expect(screen.getByTestId('icon-sparkles')).toBeInTheDocument()
    expect(screen.getByTestId('icon-atom')).toBeInTheDocument()
    expect(screen.getByTestId('icon-world')).toBeInTheDocument()
    expect(screen.getByTestId('icon-code')).toBeInTheDocument()
  })

  it('should handle empty capabilities array', () => {
    const { container } = render(<Capabilities capabilities={[]} />)

    expect(container.querySelector('[data-testid^="icon-"]')).not.toBeInTheDocument()
  })

  it('should handle unknown capabilities gracefully', () => {
    const { container } = render(<Capabilities capabilities={['unknown_capability']} />)

    expect(container).toBeInTheDocument()
  })

  it('should display proactive tooltip with correct text when all requirements met', () => {
    render(<Capabilities capabilities={['tools', 'vision', 'proactive']} />)

    // The tooltip content should be 'Proactive'
    expect(screen.getByTestId('icon-sparkles')).toBeInTheDocument()
  })

  it('should render proactive icon between tools/vision and reasoning', () => {
    const { container } = render(<Capabilities capabilities={['tools', 'vision', 'proactive', 'reasoning']} />)

    // All icons should be rendered
    expect(screen.getByTestId('icon-tool')).toBeInTheDocument()
    expect(screen.getByTestId('icon-eye')).toBeInTheDocument()
    expect(screen.getByTestId('icon-sparkles')).toBeInTheDocument()
    expect(screen.getByTestId('icon-atom')).toBeInTheDocument()

    expect(container.querySelector('[data-testid="icon-sparkles"]')).toBeInTheDocument()
  })

  it('should apply correct CSS classes to proactive icon', () => {
    render(<Capabilities capabilities={['tools', 'vision', 'proactive']} />)

    const sparklesIcon = screen.getByTestId('icon-sparkles')
    expect(sparklesIcon).toBeInTheDocument()
    // Icon should have size-3.5 class (same as tools, reasoning, etc.)
    expect(sparklesIcon.parentElement).toBeInTheDocument()
  })

  it('should NOT show proactive icon when only tools capability is present', () => {
    render(<Capabilities capabilities={['tools', 'proactive']} />)

    const sparklesIcon = screen.queryByTestId('icon-sparkles')
    expect(sparklesIcon).not.toBeInTheDocument()
  })

  it('should NOT show proactive icon when only vision capability is present', () => {
    render(<Capabilities capabilities={['vision', 'proactive']} />)

    const sparklesIcon = screen.queryByTestId('icon-sparkles')
    expect(sparklesIcon).not.toBeInTheDocument()
  })
})
