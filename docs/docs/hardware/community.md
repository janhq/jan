---
title: Hardware Examples
description: Jan is a ChatGPT-alternative that runs on your own computer, with a local API server.
keywords:
  [
    Jan AI,
    Jan,
    ChatGPT alternative,
    local AI,
    private AI,
    conversational AI,
    no-subscription fee,
    large language model,
  ]
---

<head>
  <title>Hardware Examples</title>
  <meta charset="utf-8" />
  <meta name="description" content="Jan is a ChatGPT-alternative that runs on your own computer, with a local API server. Add your own hardware examples to this page by creating a new file in the `docs/docs/hardware/examples` directory." />
  <meta name="keywords" content="Jan AI, Jan, ChatGPT alternative, local AI, private AI, conversational AI, no-subscription fee, large language model" />
  <meta name="twitter:card" content="summary" />
  <link rel="canonical" href="https://jan.ai/guides/hardware-examples" />
  <meta property="og:title" content="Hardware Examples" />
  <meta property="og:description" content="Jan is a ChatGPT-alternative that runs on your own computer, with a local API server. Add your own hardware examples to this page by creating a new file in the `docs/docs/hardware/examples` directory." />
  <meta property="og:url" content="https://jan.ai/guides/hardware-examples" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="https://jan.ai/img/og-image-hardware-examples.png" />
</head>

## Add your own example

Add your own examples to this page by creating a new file in the `docs/docs/hardware/examples` directory.

```shell
docs
└── docs
    └── hardware
        └── examples
            └── 3090x1-%40dan-jan.md
            └── 3090x1-%40dan-jan.md
            // highlight-next-line
            └── <YOUR_BUILD_HERE>.md
```

### File and Title Convention

We use a specific naming convention for the file name.

```shell
# Filename
<hardware-type><quantity>-<username>.md
3090x1-@dan-jan.md # Example

# Title
---
title: <@github_username>: <hardware_x_quantity> <form-factor>
title: @dan-jan: 3090 Desktop # Example
---
```

### Content

We highly recommend you include:

- Photos of your build
- List of the components (e.g. [PCPartPicker](https://pcpartpicker.com))
- Dimensions
- Power consumption
- Noise level
- Any stats on token generation speeds
- List of models you have run successfully on the build

## Affiliate Links

You are allowed to include affiliate links in your example.

## Longer-Term

We will likely build a simple web app to make it easier to add your own examples, sort and retrieve.
