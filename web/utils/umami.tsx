import Script from 'next/script';
import { useEffect } from 'react';

const Umami = () => {
  const appVersion = VERSION;

  useEffect(() => {
    const ping = () => {
      // Check if umami is defined before ping
      if (typeof umami !== 'undefined') {
        umami.track(appVersion, {
          version: appVersion,
        });
      }
    };

    // Wait for umami to be defined before ping
    if (typeof umami !== 'undefined') {
      ping();
    } else {
      // Listen for umami script load event
      document.addEventListener('umami:loaded', ping);
    }

    // Cleanup function to remove event listener if the component unmounts
    return () => {
      document.removeEventListener('umami:loaded', ping);
    };
  }, [appVersion]);

  return (
    <>
      {/* Assuming umami script is loaded synchronously */}
      <Script
        dangerouslySetInnerHTML={{
          __html: `
            if (typeof umami === 'undefined') {
              var umamiLoaded = new Event('umami:loaded');
              document.dispatchEvent(umamiLoaded);
            }
          `,
        }}
      />
      <Script
        src="https://us.umami.is/script.js"
        data-website-id="0d6d8b40-a7e8-4f1c-9d81-a28cfcbc28f4"
        data-cache="true"
        defer
        onLoad={() => document.dispatchEvent(new Event('umami:loaded'))}
      />
    </>
  );
};

export default Umami;
