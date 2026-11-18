import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { asyncDraftLocks, fakeClient } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

describe('B14-U01: Beta controls never expose browser default widgets',()=>{
  it('uses the shared themed profile selector and keeps its accessible name',async()=>{
    const previous=Object.getOwnPropertyDescriptor(navigator,'locks');Object.defineProperty(navigator,'locks',{configurable:true,value:asyncDraftLocks()});
    const ui=render(<BetaApp client={fakeClient()} intentJournal={memoryIntentJournal()}/>);
    try{await screen.findByRole('textbox',{name:'记录当下'});expect(screen.getByRole('combobox',{name:'当前档案'}).tagName).toBe('BUTTON');expect(ui.container.querySelector('select:not([aria-hidden="true"])')).toBeNull();}
    finally{ui.unmount();if(previous)Object.defineProperty(navigator,'locks',previous);else Reflect.deleteProperty(navigator,'locks');}
  });
});
