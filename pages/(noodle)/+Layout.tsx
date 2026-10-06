import { usePageContext } from 'vike-react/usePageContext';
import { slugify } from '../../lib/slug';

export function Layout({ children }: React.PropsWithChildren) {
  const { config } = usePageContext();
  const title = config.frontmatter?.title;
  const id = title ? slugify(title) : undefined;

  return (
    <>
      {title && (
        <h1 id={id}>
          <a href={`#${id}`} className="heading-link">
            {title}
            <span aria-hidden="true" className="heading-hash">
              #
            </span>
          </a>
        </h1>
      )}
      {children}
    </>
  );
}
