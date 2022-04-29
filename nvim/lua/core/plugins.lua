local execute = vim.api.nvim_command
local fn = vim.fn

local install_path = fn.stdpath('data') .. '/site/pack/packer/start/packer.nvim'

if fn.empty(fn.glob(install_path)) > 0 then
    fn.system({
        'git', 'clone', 'https://github.com/wbthomason/packer.nvim',
        install_path
    })
    execute 'packadd packer.nvim'
end

local packer = require('packer')
return packer.startup(function(use)
    -- Packer
    use 'wbthomason/packer.nvim'

    -- LSP
    use {
        'neovim/nvim-lspconfig',
        config = require('plugin.lspconfig'),
        requires = {'williamboman/nvim-lsp-installer'}
    }

    -- UI
    use {
        'stevearc/dressing.nvim',
        config = require('plugin.dressing'),
        requires = {'nvim-telescope/telescope.nvim'}
    }

    -- Completion
    use {
        'ms-jpq/coq_nvim',
        branch = 'coq',
        requires = {{'ms-jpq/coq.artifacts', branch = 'artifacts'}}
    }

    -- Diagnostics and formatting
    use {
        'jose-elias-alvarez/null-ls.nvim',
        requires = {'nvim-lua/plenary.nvim'},
        config = require('plugin.null-ls')
    }

    -- Syntax
    use {
        'nvim-treesitter/nvim-treesitter',
        run = ":TSUpdate",
        config = require('plugin.treesitter')
    }

    -- Appearance
    use 'kyazdani42/nvim-web-devicons'
    use {'nvim-lualine/lualine.nvim', config = require('plugin.lualine')}
    use {'dracula/vim', as = 'dracula'}

    -- Editing Keybinds
    use 'b3nj5m1n/kommentary'
    use 'tpope/vim-surround'
    use 'ggandor/lightspeed.nvim'

    -- Files
    use {
        'nvim-telescope/telescope.nvim',
        config = require('plugin.telescope'),
        requires = {"nvim-lua/popup.nvim", "nvim-lua/plenary.nvim"}
    }

    use {'kyazdani42/nvim-tree.lua', config = require('plugin.nvim-tree')}

    -- Git
    use 'tpope/vim-fugitive'
    use {
        'lewis6991/gitsigns.nvim',
        requires = {'nvim-lua/plenary.nvim'},
        config = require('plugin.gitsigns')
    }

    -- Markdown
    use {"npxbr/glow.nvim", run = ":GlowInstall"}
    use {
        'iamcco/markdown-preview.nvim',
        run = function() vim.fn['mkdp#util#install']() end,
        ft = {'markdown'}
    }

    -- Editing Simplicity
    use {"beauwilliams/focus.nvim", config = require('plugin.focus')}
    use {'karb94/neoscroll.nvim', config = require('plugin.neoscroll')}
end)
