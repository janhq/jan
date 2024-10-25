import { Button, Modal } from '@janhq/joi'
import { StrictMode } from 'react'

export const LouisView = () => {
  return (
    <StrictMode>
      <h4 className="mb-4">Hello, I'm Louis!</h4>
      <Modal
        trigger={<Button>Click Me Open Modal</Button>}
        content={
          <p>
            Lorem ipsum dolor sit amet consectetur adipisicing elit. Recusandae
            alias libero dolorem! Quas alias, earum tempore veniam harum itaque
            corporis ipsa inventore veritatis cupiditate, aperiam sint odit
            quisquam ipsam debitis.
          </p>
        }
      />
    </StrictMode>
  )
}

export const AshleyView = () => {
  const handleClick = () => {
    alert('Hello, I am Alert!')
  }

  return (
    <StrictMode>
      <h4>Hello, I'm Ashley!</h4>
      <Button onClick={handleClick} className="mt-4">
        Click Me Open Alert
      </Button>
    </StrictMode>
  )
}
