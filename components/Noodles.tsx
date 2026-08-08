import { getGlobalContextSync } from 'vike/server';
import { Link } from './Link';
import { Spaghetti } from './Spaghetti';
import { Fragment } from 'react/jsx-runtime';

export type Noodle = {
  title?: string;
  metaTitle?: string;
  kind: 'quote' | 'thought';
  description?: string;
  draft?: boolean;
  publish?: 'listed' | 'unlisted';
  added: string;
};

type NoodleModule = {
  frontmatter: Noodle;
  default: React.FC;
};

const pages = getGlobalContextSync().pages;

const noodleModules = import.meta.glob<NoodleModule>(
  '/pages/\\(noodle\\)/**/\\+Page.mdx',
  { eager: true, query: '?preview' },
);

const noodles = Object.entries(noodleModules).map(([path, module]) => {
  return {
    noodle: module.frontmatter,
    Content: module.default,
    page: pages[path.replace('/+Page.mdx', '')],
  };
});

const listableNoodles = noodles
  .filter(
    ({ noodle }) =>
      noodle !== undefined && !noodle.draft && noodle.publish === 'listed',
  )
  .sort((a, b) => (b.noodle.added ?? '').localeCompare(a.noodle.added ?? ''));

export const Noodles = () => {
  return listableNoodles.map(({ noodle, page: { route }, Content }, index) => (
    <Fragment key={route as string}>
      {index > 0 && <Spaghetti seed={route as string} variant="divider" />}
      <div className="space-between-wrap mb-4">
        <Link href={route as string}>
          <h1 className="mb-0">{noodle.title}</h1>
        </Link>
        <Link className="italic no-underline hover:underline font-serif font-soft" href={route as string}>
          {noodle.added.replaceAll('/', '.')}
        </Link>
      </div>
      <Content />
    </Fragment>
  ));
};
