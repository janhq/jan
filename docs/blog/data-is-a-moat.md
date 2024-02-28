---
title: "Data is a moat and OpenAI has it"
description: "Finetune LLMs with personal dataset"
slug: /data-is-a-moat
tags: [OpenAI has a moat]
authors:
    -   name: Rex Ha
        title: LLM Researcher & Content Writer
        url: https://github.com/hahuyhoang411
        image_url: https://avatars.githubusercontent.com/u/64120343?v=4
        email: rex@jan.ai
    -   name: Alan Dao
        title: AI Engineer
        url: https://github.com/tikikun
        image_url: https://avatars.githubusercontent.com/u/22268502?v=4
        email: alan@jan.ai
---

LLMs have grown increasingly capable in recent years across a wide variety of tasks. The leap forward has been astonishing - even for those who have built AI systems for years. The AI space is now crowded with not only closed-source AI of high quality like OpenAI-ChatGPT or Gemini-Google but also many more open-source alternatives like Meta's Llama2 or MistralAI's Mistral. With the consciousness of the whole AI community, there are variant of good fine-tuned models that claim to beat ChatGPT at some points. But actually, is that really true? and Why do these companies don't release their training dataset?

In this blog post, we discuss about:

- **Why is data ownership so crucial?**
- **What are our partial solutions?**

## **Big corporations have their own moat**

OpenAI has effectively constructed a moat in areas where even Google may struggle to compete, leveraging its unique position with ChatGPT. This platform enables OpenAI to aggregate a vast amount of user interactions, providing a comprehensive view of every daily use cases. Such insights allow for targeted model training improvements process, directly addressing real-world applications.

Crucially, OpenAI has a master key to improve their ChatGPT iterations: the "Pretrained dataset". This foundational dataset enables the them to unlock high-performance solutions across a spectrum of niche use cases, setting the stage for tailored advancements that meet specific user needs. This strategic asset not only differentiates OpenAI but also reinforces its competitive edge by facilitating continuous enhancement without quality degradation.

### **Why owning the original pre-train is important?**

This is a huge problem called "Catastrophic forgetting" in LLM development. This phenomenon occurs when a model, while learning new information (e.g., about a new topic like "birds"), starts to forget previously learned information (e.g., about "cats and dogs"). Owning the original training data allows closed-source companies to address this issue effectively. By fine-tuning their models on this mixed data, they can introduce new knowledge while minimizing the loss of existing abilities.

![Catastrophic forgetting](img/catastrophic-demo.png)

Figure 1. Demonstration of catastrophic forgetting problem

**Understanding Catastrophic Forgetting with mathematic**

During training, LLMs learn by adjusting their internal parameters to minimize a specific error function. This process can be visualized as a ball navigating a multidimensional landscape, where each dimension represents a different skill or piece of knowledge learned. Gradient descent guides the ball downhill towards an optimal point representing good performance on the training task.

However, when we introduce a new task (Case A), pushing the ball towards a new optimal point can cause it to roll away from previously learned areas, leading to catastrophic forgetting.

![Gradient decent](img/gradient-decent.gif)

Figure 2. Gradient decent

**The Advantage of Owning Original Data**

Closed-source companies with access to their original training data have a significant advantage in this scenario. This data acts as a "map" of the learning landscape. By fine-tuning their models on this data (Case B), they can navigate towards new tasks while referencing the map to avoid forgetting previously learned information. This allows them to achieve better performance and retain previously acquired knowledge compared to models relying solely on publicly available datasets.

## **What does the community actually have after all?**

### **The Reality of Open-Source LLMs**

While the open-source community boasts impressive models like Llama-2 and Mistral, these are primarily fine-tuned variations based on pre-trained weights developed by others. Open-source communities lack access to the **original training data** (the "distribution") used to create these weights. This distinction is crucial, as access to original data unlocks further fine-tuning and adaptation, which can improve model performance and capabilities.

### **The Open-Source Disadvantage**

While open-source models may occasionally outperform closed-source counterparts on specific benchmarks, the broader picture reveals a significant gap. In [Chatbot Arena Leaderboard](https://chat.lmsys.org/), a popular human-evaluated ranking system, none of the top five models are truly created and fine-tuned by the open-source community. The single model listed as "open-source" (Qwen) actually originates from Alibaba and does not represent a model developed solely by the open-source community. This highlights the current challenge faced by open-source LLMs in competing with their closed-source counterparts.

Table 1. Top 5 Chatbot Arena Leaderboard (as of February 26, 2024):

| Rank | Model               | Arena Elo | License       |
|------|---------------------|-----------|---------------|
| 1    | GPT-4-1106-preview  | 1254      | Proprietary   |
| 2    | Bard (Gemini Pro)   | 1218      | Proprietary   |
| 3    | Mistral Medium      | 1152      | Proprietary   |
| 4    | Qwen1.5-72B-Chat    | 1147      | Qianwen LICENSE |
| 5    | Claude-2.0          | 1132      | Proprietary   |

*Note: Only the best performing model from each organization is shown.*

**Data quality matters:**

Open-source communities face significant challenges in accessing the vast, curated datasets that underpin the leading LLMs. These datasets are a critical ingredient for model performance and capabilities. While the community and also some big companies have made impressive strides with high-quality offerings like [NVIDIA's datasets](https://huggingface.co/datasets/nvidia/OpenMathInstruct-1), [Openhermes](https://huggingface.co/datasets/teknium/OpenHermes-2.5), [Intel Orca DPO](https://huggingface.co/datasets/Intel/orca_dpo_pairs), [Cohere Aya](https://huggingface.co/datasets/CohereForAI/aya_dataset) or [Argilla's distilabel project](https://huggingface.co/datasets/argilla/OpenHermes2.5-dpo-binarized-alpha), the sustainability of data acquisition remains a crucial question. Where can we find the next high-quality tokens to improve and bridge the gap with closed-source counterparts?

**Computational resources:**

Training LLMs is an extremely resource-intensive process requiring immense computational power. Unfortunately, many smaller institutions lack the necessary infrastructure and resources to compete with larger companies who can leverage dedicated hardware and cloud solutions. While techniques like LoRA aim to reduce the computational cost of fine-tuning, these methods might not be sufficient to bridge the gap entirely, especially for smaller entities. The limited computational resources further hinder the open-source community's ability to create LLMs that can personalize and tailor themselves for individual user needs.

## The spark of open data loop

While data ownership remains a significant advantage for closed-source companies, the open-source community is not standing still. Initiatives like [AllenAI's Dolma dataset](https://huggingface.co/datasets/allenai/dolma) and projects such as [Pythia](https://huggingface.co/EleutherAI/pythia-6.9b) are making strides by opening up pre-training datasets. Although these datasets may not yet match the quality of those used by leading companies, they offer valuable resources that can improve the performance of open-source models in future iterations.

Furthermore, the growing availability of open-source datasets provides the community with additional tools to mitigate the data disadvantage. We can utilize techniques akin to [data shifting](https://towardsdatascience.com/understanding-dataset-shift-f2a5a262a766), a process analogous to adjusting the learning landscape. By training our models on these datasets and strategically shifting the distribution, we can gradually tailor them towards specific needs and applications. This approach, while not a complete solution, acts as a bridge-building exercise, gradually narrowing the gap between open-source and closed-source models.

## Conclusion

When it comes to building powerful Large Language Models (LLMs), owning **the original training data** is a major advantage. Big companies have built a significant edge by collecting and using exclusive datasets, giving their LLMs a big boost in performance. This makes it much harder for open-source projects to compete, even though they are actively developing innovative solutions and sharing resources. The key challenge isn't just having access to data, but having access to high-quality data in large quantities. Currently, only large companies have the resources to do this. To make LLM technology more accessible to everyone, data needs to be more open and readily available, instead of being used as a barrier by major companies. This would change the current situation and allow everyone to participate in the development of powerful LLMs.