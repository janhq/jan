import { describe, it, expect, vi } from 'vitest'

// searchSources 依赖平台检测,测试环境 mock 为“非 Tauri”(web),避免触发
// plugin-http 运行时逻辑;纯函数本身不依赖它。
const isPlatformTauri = vi.fn(() => false)
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => isPlatformTauri(),
}))

import {
  rewriteReadmeImages,
  rewriteModelscopeReadme,
  formatParamCount,
  isTrustworthyIntro,
  buildStructuredIntro,
} from '../searchSources'
import type { SearchModel } from '../searchSources'

describe('rewriteReadmeImages', () => {
  const prefix = 'https://huggingface.co/org/repo/resolve/main/'

  it('重写 markdown 相对路径图片为绝对地址', () => {
    const md = '![logo](./assets/logo.png)'
    expect(rewriteReadmeImages(md, prefix)).toBe(
      '![logo](https://huggingface.co/org/repo/resolve/main/assets/logo.png)'
    )
  })

  it('重写不带 ./ 前缀的相对路径', () => {
    const md = '![pic](assets/pic.png)'
    expect(rewriteReadmeImages(md, prefix)).toBe(
      '![pic](https://huggingface.co/org/repo/resolve/main/assets/pic.png)'
    )
  })

  it('跳过绝对 URL / data: / 锚点 / 根路径', () => {
    const cases: Array<[string, string]> = [
      ['![a](https://ex.com/x.png)', '![a](https://ex.com/x.png)'],
      ['![a](data:image/png;base64,AAAA)', '![a](data:image/png;base64,AAAA)'],
      ['![a](#section)', '![a](#section)'],
      ['![a](/root/x.png)', '![a](/root/x.png)'],
    ]
    for (const [input, expected] of cases) {
      expect(rewriteReadmeImages(input, prefix)).toBe(expected)
    }
  })

  it('重写 HTML <img src> 相对路径', () => {
    const md = '<img src="./assets/a.png" alt="a">'
    expect(rewriteReadmeImages(md, prefix)).toBe(
      '<img src="https://huggingface.co/org/repo/resolve/main/assets/a.png" alt="a">'
    )
  })

  it('跳过 HTML <img> 绝对 src', () => {
    const md = '<img src="https://ex.com/a.png">'
    expect(rewriteReadmeImages(md, prefix)).toBe(md)
  })

  it('空串原样返回', () => {
    expect(rewriteReadmeImages('', prefix)).toBe('')
  })
})

describe('rewriteModelscopeReadme', () => {
  it('使用魔搭 resolve/master 前缀', () => {
    const md = '![x](./assets/qwen.png)'
    expect(rewriteModelscopeReadme(md, 'Qwen/Qwen3')).toBe(
      '![x](https://modelscope.cn/models/Qwen/Qwen3/resolve/master/assets/qwen.png)'
    )
  })
})

describe('formatParamCount', () => {
  it('格式化参数总量', () => {
    expect(formatParamCount(27781427952)).toBe('27.8B')
    expect(formatParamCount(1_234_567)).toBe('1.2M')
    expect(formatParamCount(1_500_000_000_000)).toBe('1.5T')
    expect(formatParamCount(123)).toBe('123')
  })

  it('非法输入返回 null', () => {
    expect(formatParamCount(undefined)).toBeNull()
    expect(formatParamCount('')).toBeNull()
    expect(formatParamCount(0)).toBeNull()
    expect(formatParamCount(-5)).toBeNull()
    expect(formatParamCount('abc')).toBeNull()
  })
})

describe('isTrustworthyIntro', () => {
  it('以模型名首 token 开头视为可信', () => {
    expect(isTrustworthyIntro('Qwen3 is a great model', 'Qwen3-8B-Instruct')).toBe(
      true
    )
  })

  it('非模型首发（转发/镜像免责）视为不可信', () => {
    expect(isTrustworthyIntro('See Unsloth for more', 'Qwen3-8B')).toBe(false)
    expect(isTrustworthyIntro('Repackaged by someone', 'Qwen3-8B')).toBe(false)
    expect(isTrustworthyIntro('', 'Qwen3')).toBe(false)
    expect(isTrustworthyIntro('A generic intro', 'Qwen3')).toBe(false)
  })
})

describe('buildStructuredIntro', () => {
  const model: SearchModel = {
    repoId: 'org/qwen3',
    modelName: 'qwen3',
    developer: 'org',
    downloads: 100,
    params: 27781427952,
    tags: ['library:gguf', 'license:apache-2.0'],
  }

  it('拼接 params/library/license', () => {
    const intro = buildStructuredIntro('hf', model)
    expect(intro).toContain('27.8B parameters')
    expect(intro).toContain('GGUF')
    expect(intro).toContain('apache-2.0')
  })

  it('参数缺失时省略 parameters 段', () => {
    const m: SearchModel = { ...model, params: undefined }
    const intro = buildStructuredIntro('hf', m)
    expect(intro).not.toContain('parameters')
  })

  it('model.license 优先于 license 标签', () => {
    const m: SearchModel = { ...model, license: 'MIT' }
    const intro = buildStructuredIntro('hf', m)
    expect(intro).toContain('MIT')
    expect(intro).not.toContain('apache-2.0')
  })
})
