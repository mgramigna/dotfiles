return function()
  local prettier = function()
    return {
      exe = "prettier",
      args = {"--stdin-filepath", vim.api.nvim_buf_get_name(0), '--single-quote'},
      stdin = true
    }
  end

  require('formatter').setup({
    logging = false,
    filetype = {
      javascript = { prettier },
      typescript = { prettier },
      javascriptreact = { prettier },
      typescriptreact = { prettier },
      json = { prettier },
      markdown = { prettier },
      ruby = {
       function()
         return {
           exe = "bundle exec rubocop",
           args = { '--auto-correct', '--stdin', '%:p', '2>/dev/null', '|', "awk 'f; /^====================$/{f=1}'"},
           stdin = true,
         }
       end
     }
    }
  })

  vim.api.nvim_set_keymap('n', '<leader>f', ':Format<cr>', { noremap = true })

  vim.api.nvim_exec([[
    augroup FormatAutogroup
      autocmd!
      autocmd BufWritePost *.js,*.ts,*.jsx,*.tsx,*.rb FormatWrite
    augroup END
    ]], true)
end
