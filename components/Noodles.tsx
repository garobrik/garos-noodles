import { getGlobalContextSync } from 'vike/server';
import { Link } from './Link';

export type Noodle = {
  title?: string;
  description?: string;
  draft?: boolean;
};

type NoodleFrontmatter = {
  frontmatter: Noodle;
};

const pages = getGlobalContextSync().pages;
const noodlePages = Object.entries(pages).filter(([path]) =>
  path.startsWith('/pages/(noodle)'),
);
const noodles = await Promise.all(
  noodlePages.map(async ([path, page]) => ({
    noodle: (
      (await import(
        `../pages/(noodle)/${path.replace('/pages/(noodle)/', '')}/+Page.mdx`
      )) as NoodleFrontmatter
    ).frontmatter,
    page,
  })),
);

export const Noodles = () => {
  return noodles.map(
    ({ noodle, page: { route } }) =>
      !noodle.draft && (
        <Link
          key={route as string}
          className="no-underline"
          href={route as string}
        >
          <h3 className="underline">{noodle.title}</h3>
          <p>{noodle.description}</p>
        </Link>
      ),
  );
};
