import {render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {describe,it,expect} from 'vitest';
import axe from 'axe-core';
import {App} from '../app/App';
function app(path='/discover/recommendations'){render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>);}
describe('P5 official guide UI',()=>{
  it('keeps source provenance and missing evidence explicit',()=>{app();expect(screen.getByRole('heading',{level:1,name:'근거로 식물 찾기'})).toBeVisible();expect(screen.getAllByText('정보 부족',{exact:true})).toHaveLength(3);expect(screen.getAllByText(/내 환경 난이도: 판단 불가/)).toHaveLength(3);expect(screen.getAllByRole('link',{name:/농촌진흥청 원문/})).toHaveLength(3);});
  it('preserves all input conditions across detail and return',async()=>{app('/discover/recommendations?q=상추&region=KR_CENTRAL&method=OUTDOOR_SOIL&stage=SEEDLING&light=DIRECT&cultivar=청치마&date=2026-04-15&until=2026-11-30');await userEvent.click(screen.getByRole('link',{name:'상추 공식 자료 상세'}));expect(screen.getByRole('heading',{name:'공식 본문을 요약한 관리 가이드'})).toBeVisible();await userEvent.click(screen.getByRole('link',{name:'공식 자료 목록으로'}));expect(screen.getByLabelText('품종')).toHaveValue('청치마');expect(screen.getByLabelText('권역')).toHaveValue('KR_CENTRAL');expect(screen.getByLabelText('재배 시작일')).toHaveValue('2026-04-15');expect(screen.getByLabelText('재배 공간 이용 종료일 (선택)')).toHaveValue('2026-11-30');});
  it('shows malformed URL condition and recovers without dropping it silently',async()=>{app('/discover/recommendations?region=invalid&date=2026-02-30');expect(screen.getByRole('alert')).toHaveTextContent('입력한 날짜나 조건');await userEvent.click(screen.getByRole('button',{name:'추천 조건 초기화'}));expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(screen.getByLabelText('권역')).toHaveValue('');});
  it('keeps empty search reversible and official records separate from demo',async()=>{app();await userEvent.type(screen.getByRole('searchbox'),'몬스테라');expect(screen.getByText('일치하는 공식 자료가 없어요')).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'추천 조건 초기화'}));expect(screen.getByText('공식 자료 3종 · 적합 등급 제공 보류')).toBeVisible();});
  it('returns unknown official ID to 404',()=>{app('/discover/recommendations/unknown');expect(screen.getByRole('heading',{name:'페이지를 찾을 수 없어요'})).toBeVisible();});
  it('passes automated accessibility checks on populated recommendation and detail',async()=>{app('/discover/recommendations?q=상추');expect((await axe.run(document.body,{rules:{'color-contrast':{enabled:false}}})).violations).toEqual([]);await userEvent.click(screen.getByRole('link',{name:'상추 공식 자료 상세'}));const main=screen.getByRole('main');expect(within(main).getByRole('heading',{level:1,name:'상추'})).toBeVisible();expect((await axe.run(document.body,{rules:{'color-contrast':{enabled:false}}})).violations).toEqual([]);});
});
