import { getGlobalContextSync } from 'vike/server';

type Noodle = {
  frontmatter: {
    title: string;
    description: string;
  };
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
      )) as Noodle
    ).frontmatter,
    page,
  })),
);

export const Noodles = () => {
  return noodles.map(({ noodle, page: { route } }) => (
    <a key={route as string} className="no-underline" href={route as string}>
      <h3 className="underline">{noodle.title}</h3>
      <p>{noodle.description}</p>
    </a>
  ));
};
