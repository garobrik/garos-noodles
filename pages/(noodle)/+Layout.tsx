import { usePageContext } from 'vike-react/usePageContext';

export function Layout({ children }: React.PropsWithChildren) {
  const { config } = usePageContext();

  return (
    <>
      {config.frontmatter?.title && <h1>{config.frontmatter?.title}</h1>}
      {children}
    </>
  );
}
