call plug#begin('~/.config/nvim/bundle')
" Colors/Themes
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'sainnhe/edge'
Plug 'luochen1990/rainbow'

" Language Support
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'leafgarland/typescript-vim'
Plug 'peitalin/vim-jsx-typescript'
Plug 'pangloss/vim-javascript'
Plug 'iamcco/markdown-preview.nvim', { 'do': 'cd app & yarn install'  }

" File Finding/Navigation
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'
Plug 'jremmen/vim-ripgrep'
Plug 'christoomey/vim-tmux-navigator'
Plug 'preservim/nerdtree'

" Editing Keybinds
Plug 'scrooloose/nerdcommenter'
Plug 'tpope/vim-surround'
Plug 'jiangmiao/auto-pairs'
Plug 'alvan/vim-closetag'

" Git
Plug 'mhinz/vim-signify'
call plug#end()

" basics
filetype plugin indent on
syntax on
set number
set relativenumber
set incsearch
set ignorecase
set smartcase
set nohlsearch
set tabstop=2
set softtabstop=0
set shiftwidth=2
set expandtab
set nobackup
set noswapfile
set nowrap
set autoread

" navigate split screens easily
nmap <silent> <c-k> :wincmd k<CR>
nmap <silent> <c-j> :wincmd j<CR>
nmap <silent> <c-h> :wincmd h<CR>
nmap <silent> <c-l> :wincmd l<CR>

" change spacing for language specific
autocmd Filetype javascript setlocal ts=2 sts=2 sw=2
autocmd Filetype python setlocal ts=4 sts=4 sw=4

" close all buffers but this one
nnoremap <leader>bd :w <bar> %bd <bar> e#<CR>

" theme
if has('termguicolors')
  set termguicolors
endif

let g:edge_style = 'aura'
let g:edge_enable_italic = 1
let g:edge_disable_italic_comment = 1

colorscheme edge

let g:rainbow_active = 1

" NERDTree
autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTree") && b:NERDTree.isTabTree()) | q | endif
map <C-n> :NERDTreeToggle<CR>
let g:NERDTreeChDirMode=2
let g:NERDTreeIgnore=['\.rbc$', '\~$', '\.pyc$', '\.db$', '\.sqlite$', '__pycache__', 'node_modules']
let g:NERDTreeSortOrder=['^__\.py$', '\/$', '*', '\.swp$', '\.bak$', '\~$']
let g:NERDTreeShowBookmarks=1
let g:nerdtree_tabs_focus_on_files=1
let g:NERDTreeMapOpenInTabSilent = '<RightMouse>'
set wildignore+=*/tmp/*,*.so,*.swp,*.zip,*.pyc,*.db,*.sqlite

" jsx
let g:jsx_ext_required = 0
au BufNewFile,BufRead *.tsx setlocal filetype=typescript.tsx

" airline
let g:airline_theme='edge'
let g:airline_powerline_fonts = 1
let g:airline#extensions#tabline#enabled = 1

nmap <c-t> :GFiles --exclude-standard --others --cached<CR>
nmap <c-p> :Files<CR>
nmap <c-b> :Buffers<CR>

" CoC
let g:coc_global_extensions = [
  \ 'coc-tsserver'
  \ ]

nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gr <Plug>(coc-references)
nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)
nmap <leader>do <Plug>(coc-codeaction)
nmap <leader>rn <Plug>(coc-rename)
vmap <leader>f <Plug>(coc-format-selected)
nmap <leader>f <Plug>(coc-format-selected)
nnoremap <silent> K :call CocAction('doHover')<CR>

command! -nargs=0 Prettier :CocCommand prettier.formatFile

" vim-closetag settings
let g:closetag_filenames = '*.html,*.xhtml,*.phtml,*.jsx,*.tsx'
let g:closetag_xhtml_filenames = '*.xhtml,*.jsx,*.tsx'
let g:closetag_filetypes = 'html,xhtml,phtml,jsx,tsx'
let g:closetag_xhtml_filetypes = 'xhtml,jsx,tsx'
let g:closetag_emptyTags_caseSensitive = 1
let g:closetag_regions = {
  \ 'typescript.tsx': 'jsxRegion,tsxRegion',
  \ 'javascript.jsx': 'jsxRegion',
  \ }

let g:closetag_shortcut = '>'
let g:closetag_close_shortcut = '<leader>>'

" custom mappings
command! -nargs=0 Fjson :%!jq .
nmap <leader>p :Fjson<CR>
nmap <leader>sr :%s/\<<C-r><C-w>\>//gc<Left><Left><Left>
