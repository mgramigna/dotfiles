call plug#begin('~/.config/nvim/bundle')
" Colors/Themes
Plug 'dikiaap/minimalist'
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'

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
Plug 'scrooloose/nerdtree'
Plug 'christoomey/vim-tmux-navigator'

" Editing Keybinds
Plug 'scrooloose/nerdcommenter'
Plug 'tpope/vim-surround'

" Git
Plug 'mhinz/vim-signify'
call plug#end()

" basics
colorscheme minimalist
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
" Make Y yank everything from the cursor to the end of the line. This makes Y
" act more like C or D because by default, Y yanks the current line (i.e. the
" same as yy).
noremap Y y$
" navigate split screens easily
nmap <silent> <c-k> :wincmd k<CR>
nmap <silent> <c-j> :wincmd j<CR>
nmap <silent> <c-h> :wincmd h<CR>
nmap <silent> <c-l> :wincmd l<CR>
" change spacing for language specific
autocmd Filetype javascript setlocal ts=2 sts=2 sw=2

" plugin settings

" Theme
syntax enable
"let $NVIM_TUI_ENABLE_TRUE_COLOR=1

"NERDTree
" How can I close vim if the only window left open is a NERDTree?
autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTree") && b:NERDTree.isTabTree()) | q | endif

" toggle NERDTree
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
"
" airline
let g:airline_theme='minimalist'
let g:airline_powerline_fonts = 1
let g:airline#extensions#tabline#enabled = 1

nmap <c-t> :GFiles --exclude-standard --others --cached<CR>
nmap <c-p> :Files<CR>
nmap <c-b> :Buffers<CR>

" Journaling
augroup journal
    autocmd!

    " populate journal template
    autocmd VimEnter */journal/**   0r ~/.config/nvim/templates/journal.skeleton
    autocmd VimEnter */journal/**   set complete=k/~/journal/**/*
augroup end

" CoC
let g:coc_global_extensions = [
  \ 'coc-tsserver'
  \ ]
if isdirectory('./node_modules') && isdirectory('./node_modules/prettier')
  let g:coc_global_extensions += ['coc-prettier']
endif

if isdirectory('./node_modules') && isdirectory('./node_modules/eslint')
  let g:coc_global_extensions += ['coc-eslint']
endif

nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gr <Plug>(coc-references)
nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)
nmap <leader>do <Plug>(coc-codeaction)
nmap <leader>rn <Plug>(coc-rename)

