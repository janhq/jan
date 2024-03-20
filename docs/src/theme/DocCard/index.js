import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import {
  findFirstSidebarItemLink,
  useDocById,
} from '@docusaurus/theme-common/internal';
import isInternalUrl from '@docusaurus/isInternalUrl';
import {translate} from '@docusaurus/Translate';
import Heading from '@theme/Heading';
import styles from './styles.module.css';
import engine from './assets/engine.png';
import remote from './assets/remote.png';
import manual from './assets/manual.png';
import changelog from './assets/changelog.png';
import setup from './assets/setup.png';
import importex from './assets/import.png';
import continueint from './assets/continueint.png';
import discord from './assets/discord.png';
import raycast from './assets/raycast.png';
import azure from './assets/azure.png';
import openinter from './assets/openinter.png';
import openrouter from './assets/openrouter.png';
import denied from './assets/denied.png';
import token from './assets/token.png';
import issue from './assets/issue.png';
import amiss from './assets/amiss.png';
import broken from './assets/broken.png';
import gpu from './assets/gpu.png';
import mistral from './assets/mistral.png';
import lm from './assets/lm.png';
import ollama from './assets/ollama.png';
import claude from './assets/claude.png';
import windows from './assets/windows.png';
import mac from './assets/mac.png';
import linux from './assets/linux.png';
import llama from './assets/llama.png';
import docker from './assets/docker.png';
import tensorrt from './assets/tensorrt.png';
import groq from './assets/groq.png';

function CardContainer({href, children}) {
  return (
    <Link
      href={href}
      className={clsx('card padding--lg', styles.cardContainer)}>
      {children}
    </Link>
  );
}
function CardLayout({href, icon, title, description}) {
  return (
    <CardContainer href={href}>
      <Heading
        as="h2"
        className={clsx('text--truncate', styles.cardTitle)}
        title={title}>
        {icon} {title}
      </Heading>
      {description && (
        <p
          className={clsx(styles.cardDescription)}
          title={description}>
          {description}
        </p>
      )}
    </CardContainer>
  );
}
function CardCategory({item}) {
  const href = findFirstSidebarItemLink(item);
  // Unexpected: categories that don't have a link have been filtered upfront
  if (!href) {
    return null;
  }
  return (
    <CardLayout
      href={href}
      icon="🗃️"
      title={item.label}
      description={
        item.description ??
        translate(
          {
            message: '{count} items',
            id: 'theme.docs.DocCard.categoryDescription',
            description:
              'The default description for a category card in the generated index about how many items this category includes',
          },
          {count: item.items.length},
        )
      }
    />
  );
}
function CardLink({item}) {
  // const icon = isInternalUrl(item.href) ? '📄️' : '🔗';
  const icon = (item.label === "Customize Engine Settings") ? (
    <img src={engine} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Remote Server Integration") ? (
    <img src={remote} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Manual Import") ? (
    <img src={manual} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.7") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.6") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.5") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.4") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.3") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.2") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.1") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.0") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.3.3") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.3.2") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.3.1") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.3.0") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.2.3") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.2.2") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.2.1") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.2.0") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Extension Setup") ? (
    <img src={setup} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Import Extensions") ? (
    <img src={importex} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Continue Integration") ? (
    <img src={continueint} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "OpenRouter") ? (
    <img src={openrouter} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Azure OpenAI") ? (
    <img src={azure} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Raycast") ? (
    <img src={raycast} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Discord") ? (
    <img src={discord} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Open Interpreter") ? (
    <img src={openinter} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Permission Denied") ? (
    <img src={denied} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Unexpected Token") ? (
    <img src={token} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Undefined Issue") ? (
    <img src={issue} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Something's Amiss") ? (
    <img src={amiss} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Broken Build") ? (
    <img src={broken} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Jan not using GPU") ? (
    <img src={gpu} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Mistral AI") ? (
    <img src={mistral} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "LM Studio") ? (
    <img src={lm} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Ollama") ? (
    <img src={ollama} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.8") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.9") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.10") ? (
    <img src={changelog} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Install with Docker") ? (
    <img src={docker} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Install on Linux") ? (
    <img src={linux} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Install on Mac") ? (
    <img src={mac} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Install on Windows") ? (
    <img src={windows} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Claude") ? (
    <img src={claude} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "LlamaCPP Extension") ? (
    <img src={llama} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "TensorRT-LLM Extension") ? (
    <img src={tensorrt} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Groq") ? (
    <img src={groq} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (
    // If not "Customize Engine Settings", use default icon
    '📄️'
  );
  const doc = useDocById(item.docId ?? undefined);
  return (
    <CardLayout
      href={item.href}
      icon={icon}
      title={item.label}
      description={item.description ?? doc?.description}
    />
  );
}
export default function DocCard({item}) {
  switch (item.type) {
    case 'link':
      return <CardLink item={item} />;
    case 'category':
      return <CardCategory item={item} />;
    default:
      throw new Error(`unknown item type ${JSON.stringify(item)}`);
  }
}