import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import { resolve } from 'node:path';
import { Button } from '@/components/ui/button';

describe('shared control and text color semantics', () => {
  it('generates distinct control backgrounds and preserves their foregrounds alongside legacy text aliases', async () => {
    const config = loadConfig(resolve('tailwind.config.js'));
    const content = renderToStaticMarkup(<><Button>操作</Button><Button variant="secondary">次要操作</Button><span className="text-primary text-secondary text-muted text-muted-foreground bg-muted text-card-foreground">正文</span></>);
    const css = await postcss([tailwindcss({...config, content:[{raw:content,extension:'html'}]})]).process('@tailwind utilities;',{from:undefined});
    const declarations = new Map<string, Map<string,string>>();
    css.root.walkRules(rule => { const properties = new Map<string,string>(); rule.walkDecls(declaration => { properties.set(declaration.prop,declaration.value); }); declarations.set(rule.selector,properties); });
    const property = (selector:string,name:string) => declarations.get(selector)?.get(name);
    expect(property('.bg-primary','background-color')).toContain('--primary)');
    expect(property('.text-primary-foreground','color')).toContain('--primary-foreground)');
    expect(property('.bg-secondary','background-color')).toContain('--secondary)');
    expect(property('.text-secondary-foreground','color')).toContain('--secondary-foreground)');
    expect(property('.bg-muted','background-color')).toContain('--muted)');
    expect(property('.text-muted-foreground','color')).toContain('--muted-foreground)');
    expect(property('.text-card-foreground','color')).toContain('--card-foreground)');
    for(const name of ['primary','secondary','muted']) expect(property('.text-'+name,'color')).toContain('--text-'+name+')');
  });
});
