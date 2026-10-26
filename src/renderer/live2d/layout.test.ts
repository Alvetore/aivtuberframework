import { describe, expect, it } from 'vitest';
import { avatarLayout } from './layout';
describe('avatar placement',()=>{
  it('fits the original dimensions consistently after repeated resizes',()=>{
    const expected=avatarLayout(500,500,1000,2000);
    expect(expected).toEqual({scale:.225,x:250,y:250});
    expect(avatarLayout(1000,1000,1000,2000).scale).toBe(.45);
    expect(avatarLayout(500,500,1000,2000)).toEqual(expected);
  });
  it('scales independently and places offsets in canvas percentages',()=>{
    expect(avatarLayout(500,800,1000,2000,2,10,-25)).toEqual({scale:.7200000000000001,x:300,y:200});
  });
});
