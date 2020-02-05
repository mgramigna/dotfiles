call plug#begin('~/.config/nvim/bundle')
Plug 'Shougo/deoplete.nvim', { 'do': ':UpdateRemotePlugins' }
Plug 'scrooloose/nerdtree'
Plug 'scrooloose/nerdcommenter'
Plug 'scrooloose/syntastic'
Plug 'tpope/vim-surround'
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'christoomey/vim-tmux-navigator'
Plug 'zchee/deoplete-jedi'
Plug 'trevordmiller/nova-vim'
Plug 'pangloss/vim-javascript'
Plug 'mxw/vim-jsx'
Plug 'w0rp/ale'
Plug 'junegunn/fzf'
Plug 'iamcco/markdown-preview.nvim', { 'do': 'cd app & yarn install'  }
Plug 'briancollins/vim-jst'
Plug 'tomasiser/vim-code-dark'
Plug 'airblade/vim-gitgutter'
Plug 'sbdchd/neoformat'
Plug 'prettier/vim-prettier', { 'do': 'yarn install' }
Plug 'tpope/vim-fugitive'
Plug 'w0rp/ale'
" call PlugInstall to install new plugins
call plug#end()

" basics
colorscheme codedark
filetype plugin indent on
syntax on set number
set relativenumber
set incsearch
set ignorecase
set smartcase
set nohlsearch
set tabstop=4
set softtabstop=0
set shiftwidth=4
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

" deoplete
let g:deoplete#enable_at_startup = 1
" use tab to forward cycle
inoremap <silent><expr><tab> pumvisible() ? "\<c-n>" : "\<tab>"
" use tab to backward cycle
inoremap <silent><expr><s-tab> pumvisible() ? "\<c-p>" : "\<s-tab>"
" Close the documentation window when completion is done
autocmd InsertLeave,CompleteDone * if pumvisible() == 0 | pclose | endif

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

" ale prettier-eslint
"let g:ale_fixers = {
"\   'javascript': ['prettier_eslint'],
"\}
"let g:ale_fix_on_save = 1
"let g:ale_javascript_prettier_eslint_executable = 'prettier-eslint'
"let g:ale_javascript_prettier_eslint_use_global = 1
let g:ale_fixers = {}
let g:ale_fixers.javascript = ['eslint']
let g:ale_fix_on_save = 1

" syntastic
" set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*

let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0

" airline
let g:airline_theme = 'codedark'

" prettier
let g:prettier#config#arrow_parens = 'always'
let g:prettier#config#trailing_comma = 'all'
let g:prettier#config#single_quote = 'true'
let g:prettier#config#bracket_spacing = 'true'

autocmd BufWritePost * GitGutter
