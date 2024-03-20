---
title: Cloud vs. Self-hosting Your AI
---

The choice of how to run your AI - on GPU cloud services, on-prem, or just using an API provider - involves various trade-offs. The following is a naive exploration of the pros and cons of renting vs self-hosting.

## Cost Comparison

The following estimations use these general assumptions:

|            | Self-Hosted                              | GPT 4.0        | GPU Rental         |
| ---------- | ---------------------------------------- | -------------- | ------------------ |
| Unit Costs | $10k upfront for 2x4090s (5 year amort.) | $0.00012/token | $4.42 for 1xH100/h |

- 800 average tokens (input & output) in a single request
- Inference speed is at 24 tokens per second

### Low Usage

When operating at low capacity:

|                  | Self-Hosted | GPT 4.0 | GPU Rental |
| ---------------- | ----------- | ------- | ---------- |
| Cost per Request | $2.33       | $0.10   | $0.04      |

### High Usage

When operating at high capacity, i.e. 24 hours in a day, ~77.8k requests per month:

|                | Self-Hosted  | GPT 4.0 | GPU Rental |
| -------------- | ------------ | ------- | ---------- |
| Cost per Month | $166 (fixed) | $7465   | $3182      |

### Incremental Costs

Large context use cases are also interesting to evaluate. For example, if you had to write a 500 word essay summarizing Tolstoy's "War and Peace":

|                         | Self-Hosted          | GPT 4.0 | GPU Rental |
| ----------------------- | -------------------- | ------- | ---------- |
| Cost of "War and Peace" | (upfront fixed cost) | $94     | $40        |

> **Takeaway**: Renting on cloud or using an API is great for initially scaling. However, it can quickly become expensive when dealing with large datasets and context windows. For predictable costs, self-hosting is an attractive option.

## Business Considerations

Other business level considerations may include:

|                         | Self-Hosted | GPT 4.0 | GPU Rental |
| ----------------------- | ----------- | ------- | ---------- |
| Data Privacy            | ✅          | ❌      | ❌         |
| Offline Mode            | ✅          | ❌      | ❌         |
| Customization & Control | ✅          | ❌      | ✅         |
| Auditing                | ✅          | ❌      | ✅         |
| Setup Complexity        | ❌          | ✅      | ✅         |
| Setup Cost              | ❌          | ✅      | ✅         |
| Maintenance             | ❌          | ✅      | ❌         |

## Conclusion

The decision to run LLMs in the cloud or on in-house servers is not one-size-fits-all. It depends on your business's specific needs, budget, and security considerations. Cloud-based LLMs offer scalability and cost-efficiency but come with potential security concerns, while in-house servers provide greater control, customization, and cost predictability.

In some situations, using a mix of cloud and in-house resources can be the best way to go. Businesses need to assess their needs and assets carefully to pick the right method for using LLMs in the ever-changing world of AI technology.
