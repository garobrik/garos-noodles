import { usePageContext } from 'vike-react/usePageContext';
import { clsx } from 'clsx';
import React from 'react';

type Props = React.ComponentProps<'a'> & { href: string };

export function Link({ href, className, children, ...rest }: Props) {
  const pageContext = usePageContext();
  const { urlPathname } = pageContext;
  const isActive = href === '/' ? urlPathname === href : urlPathname.startsWith(href);
  href = import.meta.env.BASE_URL + href;
  href = normalize(href);
  return (
    <a href={href} className={clsx(isActive && 'is-active', className)} {...rest}>
      {children}
    </a>
  );
}

const normalize = (url: string) => '/' + url.split('/').filter(Boolean).join('/');
