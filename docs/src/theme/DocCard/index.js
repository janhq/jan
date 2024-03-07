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
import v047 from './assets/v0.4.7.png';
import v046 from './assets/v0.4.6.png';
import v045 from './assets/v0.4.5.png';
import v044 from './assets/v0.4.4.png';
import v043 from './assets/v0.4.3.png';
import v042 from './assets/v0.4.2.png';
import v041 from './assets/v0.4.1.png';
import v040 from './assets/v0.4.0.png';
import v033 from './assets/v0.3.3.png';
import v032 from './assets/v0.3.2.png';
import v031 from './assets/v0.3.1.png';
import v030 from './assets/v0.3.0.png';
import v023 from './assets/v0.2.3.png';
import v022 from './assets/v0.2.2.png';
import v021 from './assets/v0.2.1.png';
import v020 from './assets/v0.2.0.png';
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
import logsError from './assets/logs-error.png';

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
    <img src={v047} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.6") ? (
    <img src={v046} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.5") ? (
    <img src={v045} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.4") ? (
    <img src={v044} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.3") ? (
    <img src={v043} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.2") ? (
    <img src={v042} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.1") ? (
    <img src={v041} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.4.0") ? (
    <img src={v040} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.3.3") ? (
    <img src={v033} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.3.2") ? (
    <img src={v032} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.3.1") ? (
    <img src={v031} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.3.0") ? (
    <img src={v030} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.2.3") ? (
    <img src={v023} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.2.2") ? (
    <img src={v022} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.2.1") ? (
    <img src={v021} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "v0.2.0") ? (
    <img src={v020} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Extension Setup") ? (
    <img src={setup} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Import Extensions") ? (
    <img src={importex} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Continue") ? (
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
  ) : (item.label === "Troubleshooting NVIDIA GPU") ? (
    <img src={gpu} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Mistral AI") ? (
    <img src={mistral} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "LM Studio") ? (
    <img src={lm} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "Ollama") ? (
    <img src={ollama} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
  ) : (item.label === "How to Get Error Logs") ? (
    <img src={logsError} alt="Logo" width={'20px'} height={'20px'} style={{marginRight: '5px'}} />
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